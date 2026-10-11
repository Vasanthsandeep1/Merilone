// Service Management > Post Ads — banners posted from the B2G portal that run
// as the sliding ad carousel on the Meril One customer app's Home screen.
// Image: 1200 x 1100 px — the top of the app's Home; JPG / PNG / WebP, up to 5 MB.
module.exports = (sequelize, DataTypes) => {
  const M1Ad = sequelize.define('M1Ad', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' }, // B2G user who posted it
    title: { type: DataTypes.STRING(120), allowNull: false },                // internal name / alt text
    imagePath: { type: DataTypes.STRING, allowNull: false, field: 'image_path' },
    // Text the app draws on the banner, bottom-left (all optional).
    headline: { type: DataTypes.STRING(40), allowNull: true },
    subline: { type: DataTypes.STRING(70), allowNull: true },
    ctaText: { type: DataTypes.STRING(20), allowNull: true, field: 'cta_text' },
    // What tapping the banner does: open a service category, or nothing.
    targetType: { type: DataTypes.ENUM('none', 'category'), allowNull: false, defaultValue: 'none', field: 'target_type' },
    targetCategoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'target_category_id' },
    // Customer backgrounds that see it (home, hospital, lab, office, industry); empty = everyone.
    segments: { type: DataTypes.JSON, allowNull: true },
    startDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'start_date' },
    endDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'end_date' },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
    status: { type: DataTypes.ENUM('Active', 'Paused'), allowNull: false, defaultValue: 'Active' },
  }, {
    tableName: 'm1_ads',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['status', 'start_date', 'end_date'] }, { fields: ['user_id'] }],
  });
  return M1Ad;
};
