// Adds Firebase (needed for Android notifications) once google-services.json is in this folder.
// The file comes from Firebase console -> Project settings -> Your apps -> Android app "app.khushipoints".
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(path.join(__dirname, "google-services.json")) ? "./google-services.json" : undefined);
  return file ? { ...config, android: { ...config.android, googleServicesFile: file } } : config;
};
