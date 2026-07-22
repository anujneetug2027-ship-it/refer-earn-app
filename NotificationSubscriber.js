const mongoose = require('mongoose');

const NotificationSubscriberSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },      // display name, e.g. "Anuj"
  nameLower:    { type: String, required: true, index: true },      // lowercase, used to match @mentions
  deviceId:     { type: String, required: true, unique: true },     // persistent per-device id from localStorage
  subscription: { type: Object, required: true },                   // Web Push subscription object (endpoint + keys)
  userAgent:    { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now }
});

NotificationSubscriberSchema.pre('save', function(next) {
  this.nameLower = (this.name || '').trim().toLowerCase();
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('NotificationSubscriber', NotificationSubscriberSchema);
