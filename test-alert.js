require("dotenv").config();
const { checkAndSendOwnEqAlerts } = require("./services/ownEqExpiryAlert");

async function runTest() {
  console.log("🚀 Starting Own Equipment Alert Test...");
  try {
    await checkAndSendOwnEqAlerts();
    console.log("✅ Test Completed! Check Telegram and Email.");
  } catch (error) {
    console.error("❌ Test Failed:", error);
  } finally {
    process.exit(0);
  }
}

runTest();