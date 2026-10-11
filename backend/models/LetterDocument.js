// Letter Generate — one letter in a user's library: AI-drafted (html_content)
// or an uploaded file (file_path). `bid_number` is an OPTIONAL link to a
// tender — a letter can equally be a free-standing, general letter.
module.exports = (sequelize, DataTypes) => sequelize.define('LetterDocument', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  bidNumber: { type: DataTypes.STRING, allowNull: true, field: 'bid_number' },
  folder: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  title: { type: DataTypes.STRING(500), allowNull: false },
  htmlContent: { type: DataTypes.TEXT('medium'), allowNull: true, field: 'html_content' },
  filePath: { type: DataTypes.STRING(1000), allowNull: true, field: 'file_path' },
  fileName: { type: DataTypes.STRING(500), allowNull: true, field: 'file_name' },
  source: { type: DataTypes.ENUM('ai', 'upload', 'blank'), allowNull: false, defaultValue: 'ai' },
  // Which Meril division's letterhead (logo, signatory, stamp, footer) is applied on view/download.
  division: { type: DataTypes.ENUM('endo', 'diagno'), allowNull: true },
  templateUsed: { type: DataTypes.STRING(500), allowNull: true, field: 'template_used' },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
  // [{ at, by, to: [emails], via }] — who this letter was sent to.
  shares: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'letter_documents',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'idx_letter_user_folder', fields: ['user_id', 'folder'] }, { name: 'idx_letter_user_bid', fields: ['user_id', 'bid_number'] }],
});
