# Finance Sync 1.3.2: legacy non-breaking space in UTF-8 exports

One client voucher export declared UTF-8 but contained a standalone byte A0 in
narration. The strict decoder rejected the entire capture. The compatibility
decoder now interprets only standalone A0 at a UTF-8 character boundary as U+00A0
(non-breaking space). It preserves that character, rather than deleting it or
converting it to a regular space. Valid UTF-8 remains unchanged, including A0
continuation bytes. Other malformed encodings, surrogate sequences, overlong
encodings and incomplete characters remain errors.

The streaming decoder retains only character validation state between chunks.
Export diagnostics include `encodingCompatibility.legacyNbspCount` and up to eight
zero-based offsets in the original decompressed response. No narration or other
record contents are added to logs. The archived XML tree contains the interpreted
Unicode character; it is not a byte-for-byte archive of the original response.

Install the 1.3.2 EXE over 1.3.1. This change needs no backend update or database
migration. It makes no writes to Tally and adds no retries or requests. The earlier
1.3.1 backend changes remain prerequisites for repeated scalar fields.

Verification: synthetic tests cover all split positions, valid Unicode, bounded
diagnostics and rejection of other malformed bytes. The supplied client response
was replayed locally through the actual export path at three chunk sizes: all 67
vouchers parsed, with one compatibility correction at byte 310293. Client source
data was not copied into the repository or sent to Finance. A live full company
sync and financial reconciliation remain separate acceptance checks.
