// debugAdmin.js - Detailed debug script
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./src/models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/spa_db';

async function debugAndCreate() {
  try {
    console.log('🔗 Attempting to connect to:', MONGODB_URI);
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected successfully!');
    console.log('📊 Database name:', mongoose.connection.name);
    
    // Check User model
    console.log('\n📋 User Model Info:');
    console.log('Collection name:', User.collection.name);
    console.log('Model name:', User.modelName);
    
    // Count existing users
    const userCount = await User.countDocuments();
    console.log('\n👥 Current users in database:', userCount);
    
    // List all users
    if (userCount > 0) {
      const allUsers = await User.find({});
      console.log('\n📄 Existing users:');
      allUsers.forEach(u => {
        console.log(`  - ${u.name} (${u.email}) - Role: ${u.role}`);
      });
    }
    
    // Create admin
    console.log('\n🔨 Creating admin user...');
    const hashedPassword = await bcrypt.hash('Admin123!', 10);
    
    const adminData = {
      name: 'Admin',
      email: 'admin@nagomiwellness.com',
      passwordHash: hashedPassword,
      role: 'admin'
    };
    
    console.log('Admin data to save:', {
      name: adminData.name,
      email: adminData.email,
      role: adminData.role,
      passwordHash: '(hashed)'
    });
    
    const admin = new User(adminData);
    
    // Validate before saving
    const validationError = admin.validateSync();
    if (validationError) {
      console.log('❌ Validation Error:', validationError);
      process.exit(1);
    }
    
    console.log('✅ Validation passed');
    
    // Save to database
    const savedAdmin = await admin.save();
    console.log('\n✅ Admin saved successfully!');
    console.log('Saved admin ID:', savedAdmin._id);
    
    // Verify it was saved
    const verifyCount = await User.countDocuments();
    console.log('\n✅ Total users now:', verifyCount);
    
    // Try to find the admin we just created
    const foundAdmin = await User.findOne({ email: 'admin@nagomiwellness.com' });
    if (foundAdmin) {
      console.log('✅ Admin found in database!');
      console.log('  Name:', foundAdmin.name);
      console.log('  Email:', foundAdmin.email);
      console.log('  Role:', foundAdmin.role);
    } else {
      console.log('❌ Admin NOT found after saving!');
    }
    
    console.log('\n🎉 Process complete!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

debugAndCreate();