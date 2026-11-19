const XLSX = require("xlsx");
const { HEADERS } = require("./product-import-service");
const { listVisible } = require("../repositories/product-repository");

function exportProducts(state) {
  const rows = listVisible(state).map(product => {
    const details = state.config?.productImports?.metadata?.[product.id] || {};
    const unit = product.unit ?? "";
    // Original split fields remain accurate only while the current unit matches.
    const originalUnit = [details.specification, details.mainUnit].filter(Boolean).join(" / ");
    const specification = unit === originalUnit ? details.specification : unit;
    const mainUnit = unit === originalUnit ? details.mainUnit : "";
    return [product.name, product.category, product.barcode || product.pospalBarcode, specification, mainUnit,
      product.stock, details.costPrice, product.regularPrice, details.wholesalePrice, product.cashPrice,
      details.memberDiscount, details.stockMax, details.stockMin, details.brand, details.supplier,
      details.productionDate, details.shelfLife].map(value => value ?? "");
  });
  const book = XLSX.utils.book_new();
  // BIFF8 permits 65536 rows including the header; retain every product on overflow sheets.
  const limit = 65535;
  for (let offset = 0; offset < Math.max(1, rows.length); offset += limit) {
    const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows.slice(offset, offset + limit)]);
    sheet["!cols"] = HEADERS.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(book, sheet, offset ? `商品${Math.floor(offset / limit) + 1}` : "商品");
  }
  return XLSX.write(book, { type: "buffer", bookType: "biff8" });
}

module.exports = { exportProducts };
