import mongoose from 'mongoose';

export async function connectDB(): Promise<boolean> {
  const fallbackUri = 'mongodb://127.0.0.1:27017/bugsafari';
  const uri = process.env.MONGODB_URI ?? fallbackUri;

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    console.log(`🟢 BugSafari Database Connected (${uri}).`);
    return true;
  } catch (err) {
    console.error('🟡 DB Connection unavailable, running without persistence:', err);
    return false;
  }
}
