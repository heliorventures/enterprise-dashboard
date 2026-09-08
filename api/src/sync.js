const db = require('./db');
const tally = require('./tally');
const { sql } = db;

async function logSync(source, status, message) {
  await db.query(
    `INSERT INTO dbo.SyncLog (Source, Status, Message) VALUES (@source, @status, @message)`,
    {
      source,
      status,
      message: String(message || '').slice(0, 1000),
    }
  );
}

async function upsertCompany(name) {
  const existing = await db.query(
    `SELECT CompanyID, CompanyName FROM dbo.Companies WHERE CompanyName = @name`,
    { name }
  );

  if (existing.recordset[0]) {
    return existing.recordset[0];
  }

  const inserted = await db.getPool().then((pool) =>
    pool
      .request()
      .input('name', sql.NVarChar(200), name)
      .query(`
        INSERT INTO dbo.Companies (CompanyName, IsActive, CreatedDate)
        OUTPUT INSERTED.CompanyID, INSERTED.CompanyName
        VALUES (@name, 1, GETDATE())
      `)
  );

  return inserted.recordset[0];
}

async function replaceLedgers(companyId, ledgers) {
  const pool = await db.getPool();
  await pool.request().input('companyId', sql.Int, companyId)
    .query('DELETE FROM dbo.Ledgers WHERE CompanyID = @companyId');

  for (const ledger of ledgers) {
    await pool
      .request()
      .input('companyId', sql.Int, companyId)
      .input('name', sql.NVarChar(200), String(ledger.name).slice(0, 200))
      .input('group', sql.NVarChar(100), String(ledger.parent || 'Primary').slice(0, 100))
      .input('balance', sql.Decimal(18, 2), ledger.balance || 0)
      .query(`
        INSERT INTO dbo.Ledgers (CompanyID, LedgerName, GroupCategory, CurrentBalance)
        VALUES (@companyId, @name, @group, @balance)
      `);
  }
}

async function replaceVouchers(companyId, vouchers) {
  const pool = await db.getPool();
  await pool.request().input('companyId', sql.Int, companyId)
    .query(`
      DELETE FROM dbo.Vouchers
      WHERE CompanyID = @companyId
        AND (VoucherNumber IS NOT NULL OR ProjectID IS NULL)
    `);

  for (const voucher of vouchers) {
    await pool
      .request()
      .input('companyId', sql.Int, companyId)
      .input('date', sql.Date, voucher.date)
      .input('type', sql.NVarChar(80), String(voucher.type || 'Journal').slice(0, 80))
      .input('number', sql.NVarChar(80), voucher.number ? String(voucher.number).slice(0, 80) : null)
      .input('party', sql.NVarChar(200), voucher.party ? String(voucher.party).slice(0, 200) : null)
      .input('amount', sql.Decimal(18, 2), voucher.amount || 0)
      .input('narration', sql.NVarChar(400), String(voucher.narration || '').slice(0, 400))
      .query(`
        INSERT INTO dbo.Vouchers
          (CompanyID, ProjectID, VoucherDate, VoucherType, Amount, Narration, VoucherNumber, PartyLedgerName)
        VALUES
          (@companyId, NULL, @date, @type, @amount, @narration, @number, @party)
      `);
  }
}

async function syncFromTally() {
  const status = await tally.ping({ fresh: true });
  if (!status.connected) {
    await logSync('tally', 'error', status.message);
    return status;
  }

  const names = status.companies;
  let ledgerCount = 0;
  let voucherCount = 0;

  for (const name of names) {
    const company = await upsertCompany(name);
    try {
      const { ledgers } = await tally.fetchCompanyFinancials(name);
      await replaceLedgers(company.CompanyID, ledgers);
      ledgerCount += ledgers.length;

      const vouchers = await tally.fetchCompanyVouchers(name);
      await replaceVouchers(company.CompanyID, vouchers);
      voucherCount += vouchers.length;
    } catch (error) {
      await logSync('tally', 'error', `${name}: ${error.message}`);
    }
  }

  const message = `Synced ${names.length} company(ies), ${ledgerCount} ledgers, ${voucherCount} vouchers`;
  await logSync('tally', 'ok', message);
  return { ...status, synced: names.length, ledgerCount, voucherCount, message };
}

module.exports = {
  syncFromTally,
};
