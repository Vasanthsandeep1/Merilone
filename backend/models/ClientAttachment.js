module.exports = (sequelize, DataTypes) => {
  const ClientAttachment = sequelize.define('ClientAttachment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clientId: { type: DataTypes.INTEGER, allowNull: false, field: 'client_id' },
    fileName: { type: DataTypes.STRING, allowNull: false, field: 'file_name' },
    filePath: { type: DataTypes.STRING, allowNull: false, field: 'file_path' },
    fileSize: { type: DataTypes.BIGINT, allowNull: true, field: 'file_size' },
  }, {
    tableName: 'client_attachments',
    timestamps: true,
    underscored: true,
  });

  return ClientAttachment;
};
