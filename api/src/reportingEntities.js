// Explicit entity mapping; shared browser compatibility is provided by a read-only SQL view.
const entities = {
  GROUP: {
    table: "account_groups",
    fields: ["parent_name"],
    relationships: [
      {
        key: "parent_source_key",
        collection: "GROUP",
        field: "parent_name",
      },
    ],
  },
  VOUCHERTYPE: {
    table: "voucher_types",
    fields: ["parent_name"],
    relationships: [
      {
        key: "parent_source_key",
        collection: "VOUCHERTYPE",
        field: "parent_name",
      },
    ],
  },
  CURRENCY: {
    table: "currencies",
    fields: [],
    relationships: [],
  },
  COSTCATEGORY: {
    table: "cost_categories",
    fields: [],
    relationships: [],
  },
  COSTCENTRE: {
    table: "cost_centres",
    fields: ["parent_name", "category_name"],
    relationships: [
      {
        key: "parent_source_key",
        collection: "COSTCENTRE",
        field: "parent_name",
      },
      {
        key: "category_source_key",
        collection: "COSTCATEGORY",
        field: "category_name",
      },
    ],
  },
  STOCKGROUP: {
    table: "stock_groups",
    fields: ["parent_name"],
    relationships: [
      {
        key: "parent_source_key",
        collection: "STOCKGROUP",
        field: "parent_name",
      },
    ],
  },
  STOCKCATEGORY: {
    table: "stock_categories",
    fields: ["parent_name"],
    relationships: [
      {
        key: "parent_source_key",
        collection: "STOCKCATEGORY",
        field: "parent_name",
      },
    ],
  },
  STOCKITEM: {
    table: "stock_items",
    fields: ["parent_name", "category_name", "base_units"],
    relationships: [
      {
        key: "group_source_key",
        collection: "STOCKGROUP",
        field: "parent_name",
      },
      {
        key: "category_source_key",
        collection: "STOCKCATEGORY",
        field: "category_name",
      },
      {
        key: "unit_source_key",
        collection: "UNIT",
        field: "base_units",
      },
    ],
  },
  UNIT: {
    table: "units",
    fields: [],
    relationships: [],
  },
  GODOWN: {
    table: "godowns",
    fields: ["parent_name"],
    relationships: [
      {
        key: "parent_source_key",
        collection: "GODOWN",
        field: "parent_name",
      },
    ],
  },
};
module.exports = {
  entities,
  tables: Object.values(entities).map((e) => e.table),
};
