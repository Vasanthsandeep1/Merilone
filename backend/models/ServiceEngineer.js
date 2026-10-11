// Service Management > Service Engineers — this partner's service engineers
// (field staff who repair / service equipment). Each engineer can cover
// several states and several districts in each; those live one row per
// (state, district) in ServiceEngineerArea (service_engineer_areas), so
// "who covers district X" is a plain indexed query.
//
// Skills: each company has its own skill list (ServiceSkill). It starts with
// the Meril One service categories (m1CategoryId set — these are what match
// customer jobs in the app); the company can add more of its own. Engineers
// get skills through ServiceEngineerSkill.
module.exports = (sequelize, DataTypes) => {
  const ServiceEngineer = sequelize.define('ServiceEngineer', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    empId: { type: DataTypes.STRING(50), allowNull: false, field: 'emp_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING(15), allowNull: false }, // 10 digits
    email: { type: DataTypes.STRING, allowNull: true },
    experienceYears: { type: DataTypes.INTEGER, allowNull: true, field: 'experience_years' },
    status: { type: DataTypes.ENUM('Active', 'Inactive'), allowNull: false, defaultValue: 'Active' },
  }, {
    tableName: 'service_engineers',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['user_id', 'emp_id'] },
      { fields: ['user_id', 'phone'] },
    ],
  });

  const ServiceEngineerArea = sequelize.define('ServiceEngineerArea', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    engineerId: { type: DataTypes.INTEGER, allowNull: false, field: 'engineer_id' },
    state: { type: DataTypes.STRING(80), allowNull: false },
    district: { type: DataTypes.STRING(120), allowNull: false },
  }, {
    tableName: 'service_engineer_areas',
    timestamps: false,
    underscored: true,
    indexes: [
      { unique: true, fields: ['engineer_id', 'state', 'district'] },
      { fields: ['state', 'district'] },
    ],
  });

  const ServiceSkill = sequelize.define('ServiceSkill', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    name: { type: DataTypes.STRING(120), allowNull: false },
    // Set for the Meril One service categories; null for the company's own.
    m1CategoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'm1_category_id' },
  }, {
    tableName: 'service_skills',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'name'] }],
  });

  const ServiceEngineerSkill = sequelize.define('ServiceEngineerSkill', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    engineerId: { type: DataTypes.INTEGER, allowNull: false, field: 'engineer_id' },
    skillId: { type: DataTypes.INTEGER, allowNull: false, field: 'skill_id' },
  }, {
    tableName: 'service_engineer_skills',
    timestamps: false,
    underscored: true,
    indexes: [{ unique: true, fields: ['engineer_id', 'skill_id'] }, { fields: ['skill_id'] }],
  });

  ServiceEngineer.hasMany(ServiceEngineerArea, { foreignKey: 'engineerId', as: 'areas', onDelete: 'CASCADE' });
  ServiceEngineerArea.belongsTo(ServiceEngineer, { foreignKey: 'engineerId', as: 'engineer' });
  ServiceEngineer.belongsToMany(ServiceSkill, { through: ServiceEngineerSkill, foreignKey: 'engineerId', otherKey: 'skillId', as: 'skills' });
  ServiceSkill.belongsToMany(ServiceEngineer, { through: ServiceEngineerSkill, foreignKey: 'skillId', otherKey: 'engineerId', as: 'engineers' });

  return { ServiceEngineer, ServiceEngineerArea, ServiceSkill, ServiceEngineerSkill };
};
