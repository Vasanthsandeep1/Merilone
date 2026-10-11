// Read-only mirror of the tender-automation system's `gem_tender_docs` table
// — one row per bid_number with the scraped document links.
module.exports = (sequelize, DataTypes) => {
  const GemTenderDoc = sequelize.define('GemTenderDoc', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    detailUrl: { type: DataTypes.TEXT, field: 'detail_url' },
    pdfUrl: { type: DataTypes.TEXT, field: 'pdf_url' },
  }, {
    tableName: 'gem_tender_docs',
    timestamps: false,
  });

  return GemTenderDoc;
};
