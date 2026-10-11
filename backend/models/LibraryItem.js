// Clone of the automation site's `library_items` table (Workdesk > Library)
// — a folder/file tree with two division root folders. Scoped to
// `ownerUserId` here (unlike the original, a shared internal Meril tool)
// since each OEM/Reseller partner needs their own private document library,
// not one shared across every tenant on this portal.
module.exports = (sequelize, DataTypes) => {
  const LibraryItem = sequelize.define('LibraryItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    ownerUserId: { type: DataTypes.INTEGER, allowNull: false, field: 'owner_user_id' },
    parentId: { type: DataTypes.INTEGER, allowNull: true, field: 'parent_id' },
    division: { type: DataTypes.ENUM('diagno', 'endo'), allowNull: true },
    type: { type: DataTypes.ENUM('folder', 'file'), allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    filePath: { type: DataTypes.STRING, allowNull: true, field: 'file_path' },
    fileSize: { type: DataTypes.BIGINT, allowNull: true, field: 'file_size' },
    mimeType: { type: DataTypes.STRING, allowNull: true, field: 'mime_type' },
    expiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'expiry_date' },
  }, {
    tableName: 'library_items',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['owner_user_id', 'parent_id'] }],
  });

  return LibraryItem;
};
