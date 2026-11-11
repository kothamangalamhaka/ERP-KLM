const express = require("express");
const pool = require("../config/db");
const { verifyToken } = require("../middlewares/auth");
const router = express.Router();

// Global In-Memory Sync Version for instantaneous sync across all clients
let globalDbSyncVersion = Date.now().toString();

function bumpDbSyncVersion() {
  globalDbSyncVersion = Date.now().toString();
}

// 🟢 Ultra-fast 0ms latency endpoint
router.get("/api/db/sync-version", verifyToken, async (req, res) => {
  res.json({ success: true, version: globalDbSyncVersion });
});

module.exports = {
  router,
  bumpDbSyncVersion,
};
