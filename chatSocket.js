const webpush = require("web-push");
const NotificationSubscriber = require("./models/NotificationSubscriber");

// Configure web-push with VAPID keys (set these in your .env)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@ambikashelf.shop",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn("⚠️ VAPID keys not set — @mention push notifications are disabled. See .env.example");
}

// Matches @name mentions (2-20 word chars) inside a message
const MENTION_REGEX = /@([a-zA-Z0-9_]{2,20})/g;

// Look up mentioned users in the message text and push a notification to each
// registered device, skipping the sender mentioning themselves.
async function notifyMentions({ text, senderUsername }) {
  if (!text || !process.env.VAPID_PUBLIC_KEY) return;

  const mentioned = new Set();
  let m;
  MENTION_REGEX.lastIndex = 0;
  while ((m = MENTION_REGEX.exec(text)) !== null) {
    mentioned.add(m[1].toLowerCase());
  }
  if (mentioned.size === 0) return;

  for (const name of mentioned) {
    if (name === (senderUsername || "").toLowerCase()) continue; // don't notify self

    try {
      const subscribers = await NotificationSubscriber.find({ nameLower: name });
      for (const sub of subscribers) {
        const payload = JSON.stringify({
          title: senderUsername,          // sender's name, not "@name"
          body: text,                     // the actual message
          icon: "/icons/ambikashelf.png", // AmbikaShelf logo, like Telegram/WhatsApp
          badge: "/icons/ambikashelf.png",
          url: "/worldchat"
        });

        try {
          await webpush.sendNotification(sub.subscription, payload);
        } catch (err) {
          // Subscription expired or was revoked by the browser — clean it up
          if (err.statusCode === 404 || err.statusCode === 410) {
            await NotificationSubscriber.deleteOne({ _id: sub._id });
          } else {
            console.error("Push error:", err.message);
          }
        }
      }
    } catch (err) {
      console.error("Mention lookup error:", err.message);
    }
  }
}

module.exports = function(io) {

  let messages = [];
  let users = {};
  let typingUsers = {};

  function cleanOldMessages() {
    const now = Date.now();
    messages = messages.filter(
      m => now - m.createdAt < 24 * 60 * 60 * 1000
    );
  }

  io.on("connection", (socket) => {

    socket.on("join", (username) => {
      if (!username) return;

      users[socket.id] = username;
      cleanOldMessages();

      socket.emit("oldMessages", messages.slice(-50));

      io.emit("message", {
        id: Date.now(),
        user: "AmbikaShelf",
        text: `${username} joined the chat`,
        time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        createdAt: Date.now()
      });
    });

    socket.on("typing", () => {
      typingUsers[socket.id] = users[socket.id];
      socket.broadcast.emit("typing", users[socket.id]);
    });

    socket.on("stopTyping", () => {
      delete typingUsers[socket.id];
      socket.broadcast.emit("stopTyping");
    });

    socket.on("sendMessage", (data) => {
      const username = data.isBot ? "AmbikaShelf" : users[socket.id];
      if (!username) return;

      cleanOldMessages();

      const messageData = {
        id: Date.now(),
        user: username,
        text: data.text || "",
        image: data.image || null,
        video: data.video || null,
        pdf: data.pdf || null,
        pdfName: data.pdfName || null,
        voice: data.voice || null,
        voiceDur: data.voiceDur || null,
        reply: data.reply || null,
        reactions: {},
        time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        createdAt: Date.now()
      };

      messages.push(messageData);
      if (messages.length > 100) messages.shift();

      io.emit("message", messageData);

      // Fire-and-forget: notify any @mentioned, registered users
      notifyMentions({ text: messageData.text, senderUsername: username }).catch(() => {});
    });

    socket.on("react", ({ id, emoji }) => {
      const msg = messages.find(m => m.id === id);
      if (!msg) return;

      msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;

      io.emit("reactionUpdate", {
        id,
        reactions: msg.reactions
      });
    });

    socket.on("disconnect", () => {
      const username = users[socket.id];

      if (username) {
        io.emit("message", {
          id: Date.now(),
          user: "AmbikaShelf",
          text: `${username} left the chat`,
          time: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
          createdAt: Date.now()
        });
      }

      delete users[socket.id];
      delete typingUsers[socket.id];
    });

  });

};
