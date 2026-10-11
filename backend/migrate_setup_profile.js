// One-off migration: creates all the OEM/Reseller Setup Profile tables (see
// SETUP_PROFILE.txt) and seeds the Company Type -> Category -> Sub-Category
// -> Product master hierarchy (config/seedProductMaster.js). Also adds
// users.profile_submitted.
require('dotenv').config();
const { sequelize } = require('./config/db');
const { User, PartnerProfile, PartnerContact, PartnerLocation, PartnerTaxRegistration, PartnerCertificate, CompanyCategory, CompanySubCategory, ProductMasterItem, PartnerProductSelection } = require('./models');
const seedData = require('./config/seedProductMaster');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  await User.sync({ alter: true });
  console.log('✅ users table synced — profile_submitted column is in place');

  for (const Model of [PartnerProfile, PartnerContact, PartnerLocation, PartnerTaxRegistration, PartnerCertificate, CompanyCategory, CompanySubCategory, ProductMasterItem, PartnerProductSelection]) {
    await Model.sync();
  }
  console.log('✅ Setup Profile tables ready');

  let categoryCount = 0, subCategoryCount = 0, productCount = 0;
  for (const [categoryIndex, entry] of seedData.entries()) {
    const [category] = await CompanyCategory.findOrCreate({ where: { name: entry.category }, defaults: { name: entry.category, sortOrder: categoryIndex } });
    categoryCount++;

    const subCategoryNames = Object.keys(entry.subCategories);
    for (const [subIndex, subName] of subCategoryNames.entries()) {
      const [subCategory] = await CompanySubCategory.findOrCreate({ where: { categoryId: category.id, name: subName }, defaults: { categoryId: category.id, name: subName, sortOrder: subIndex } });
      subCategoryCount++;

      for (const productName of entry.subCategories[subName]) {
        const [, created] = await ProductMasterItem.findOrCreate({ where: { subCategoryId: subCategory.id, name: productName }, defaults: { subCategoryId: subCategory.id, name: productName } });
        if (created) productCount++;
      }
    }
  }
  console.log(`✅ Seeded ${categoryCount} categories, ${subCategoryCount} sub-categories, ${productCount} new products`);

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => { console.error('❌ Migration failed:', err.message); process.exit(1); });
