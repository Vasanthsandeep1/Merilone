// Read-only mirror of the tender-automation system's `incidents` table.
module.exports = (sequelize, DataTypes) => {
  const Incident = sequelize.define('Incident', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    incidentId: { type: DataTypes.STRING, field: 'incident_id' },
    status: { type: DataTypes.STRING },
    dept: { type: DataTypes.STRING },
  }, {
    tableName: 'incidents',
    timestamps: false,
  });

  return Incident;
};
