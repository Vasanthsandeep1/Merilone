module.exports = (sequelize, DataTypes) => {
  const VendorAttachment = sequelize.define('VendorAttachment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    vendorId: { type: DataTypes.INTEGER, allowNull: false, field: 'vendor_id' },
    fileName: { type: DataTypes.STRING, allowNull: false, field: 'file_name' },
    filePath: { type: DataTypes.STRING, allowNull: false, field: 'file_path' },
    fileSize: { type: DataTypes.INTEGER, allowNull: true, field: 'file_size' },
  }, {
    tableName: 'vendor_attachments',
    timestamps: true,
    underscored: true,
  });

  return VendorAttachment;
};
