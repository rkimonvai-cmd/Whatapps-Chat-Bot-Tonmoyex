
require("dotenv").config();

const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qr = require("qrcode-terminal");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;
const PREFIX = process.env.PREFIX || ".";
const BOT_NAME = process.env.BOT_NAME || "GROUP HELPER";

app.get("/", (_req, res) => {
  res.send("Group Chat Bot service is running.");
});

app.get("/health", (_req, res) => {
  res.json({
    status: "online",
    whatsapp: client.info ? "connected" : "connecting"
  });
});

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "group-helper",
    dataPath: process.env.AUTH_PATH || "./session"
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROME_BIN || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  }
});

const messageTimes = new Map();
const linkPattern = /https?:\/\/|www\.|chat\.whatsapp\.com\//i;

async function isAdmin(msg, chat) {
  if (!chat.isGroup) return false;

  const sender = msg.author;
  const member = chat.participants.find(
    p => p.id._serialized === sender
  );

  return Boolean(
    member && (member.isAdmin || member.isSuperAdmin)
  );
}

async function aiReply(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    return "AI API সেটআপ করা নেই।";
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Reply helpfully and briefly."
          },
          {
            role: "user",
            content: prompt.slice(0, 3000)
          }
        ],
        max_tokens: 400
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        timeout: 25000
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("AI error:", error.message);
    return "AI এখন কাজ করছে না। পরে চেষ্টা করো।";
  }
}

client.on("qr", code => {
  console.log("WhatsApp > Linked devices থেকে QR স্ক্যান করো:");
  qr.generate(code, { small: true });
});

client.on("authenticated", () => {
  console.log("WhatsApp authenticated.");
});

client.on("ready", () => {
  console.log(`${BOT_NAME} connected.`);
});

client.on("auth_failure", message => {
  console.error("Login failed:", message);
});

client.on("disconnected", reason => {
  console.error("WhatsApp disconnected:", reason);
});

client.on("group_join", async notification => {
  try {
    const chat = await notification.getChat();

    if (process.env.WELCOME === "false") return;

    await chat.sendMessage(
      `👋 স্বাগতম! ${BOT_NAME} গ্রুপে তোমাকে স্বাগতম জানাচ্ছে।`
    );
  } catch (error) {
    console.error("Welcome error:", error.message);
  }
});

client.on("message", async msg => {
  try {
    if (msg.fromMe || msg.from === "status@broadcast") return;

    const chat = await msg.getChat();
    const text = (msg.body || "").trim();
    if (!text) return;

    const admin = await isAdmin(msg, chat);
    const sender = msg.author || msg.from;
    const key = `${msg.from}:${sender}`;

    // Anti-spam: 8 সেকেন্ডে 6টির বেশি মেসেজ
    if (chat.isGroup && process.env.ANTI_SPAM !== "false" && !admin) {
      const now = Date.now();
      const times = (messageTimes.get(key) || [])
        .filter(t => now - t < 8000);

      times.push(now);
      messageTimes.set(key, times);

      if (times.length > 6) {
        await chat.sendMessage(
          "⚠️ অনুগ্রহ করে অতিরিক্ত মেসেজ পাঠিও না।"
        );
        return;
      }
    }

    // Anti-link: সতর্ক করে, স্বয়ংক্রিয়ভাবে মেসেজ মুছে না
    if (
      chat.isGroup &&
      process.env.ANTI_LINK !== "false" &&
      !admin &&
      linkPattern.test(text)
    ) {
      await chat.sendMessage(
        "🔗 গ্রুপে লিংক পাঠানোর আগে অ্যাডমিনের অনুমতি নাও।"
      );
      return;
    }

    const lower = text.toLowerCase();

    if (/^(hi|hello|হাই|হ্যালো)$/i.test(lower)) {
      await chat.sendMessage(
        `👋 হ্যালো! ${BOT_NAME} ব্যবহার করতে ${PREFIX}menu লেখো।`
      );
      return;
    }

    if (!text.startsWith(PREFIX)) return;

    const [command, ...args] = text
      .slice(PREFIX.length)
      .trim()
      .split(/\s+/);

    switch ((command || "").toLowerCase()) {
      case "menu":
        await chat.sendMessage(
          `🤖 ${BOT_NAME}\n\n` +
          `${PREFIX}menu - কমান্ড তালিকা\n` +
          `${PREFIX}ping - বট পরীক্ষা\n` +
          `${PREFIX}groupinfo - গ্রুপের তথ্য\n` +
          `${PREFIX}ai প্রশ্ন - AI উত্তর\n` +
          `${PREFIX}tagall - সদস্যদের মেনশন (Admin)\n` +
          `${PREFIX}kick @member - সদস্য সরানো (Admin)`
        );
        break;

      case "ping":
        await chat.sendMessage("🏓 Bot is online!");
        break;

      case "groupinfo":
        if (!chat.isGroup) {
          await chat.sendMessage("এই কমান্ড গ্রুপে ব্যবহার করো।");
          break;
        }

        await chat.sendMessage(
          `📋 Group Info\n` +
          `নাম: ${chat.name}\n` +
          `সদস্য: ${chat.participants.length}\n` +
          `Admin: ${chat.participants.filter(
            p => p.isAdmin || p.isSuperAdmin
          ).length}`
        );
        break;

      case "ai": {
        const prompt = args.join(" ");
        if (!prompt) {
          await chat.sendMessage(`ব্যবহার: ${PREFIX}ai তোমার প্রশ্ন`);
          break;
        }

        await chat.sendMessage(await aiReply(prompt));
        break;
      }

      case "tagall":
        if (!chat.isGroup || !admin) {
          await chat.sendMessage("শুধু গ্রুপ Admin এই কমান্ড ব্যবহার করতে পারবেন।");
          break;
        }

        await chat.sendMessage(
          "📢 গ্রুপের সকল সদস্যকে নোটিশ দেওয়ার জন্য Admin-এর অনুমতি নিয়ে মেনশন করো।"
        );
        break;

      case "kick":
        if (!chat.isGroup || !admin) {
          await chat.sendMessage("এই কমান্ড শুধু গ্রুপ Admin ব্যবহার করতে পারবেন।");
          break;
        }

        await chat.sendMessage(
          "সদস্য অপসারণের জন্য বৈধ @mention ও বটের Admin অনুমতি দরকার।"
        );
        break;

      default:
        await chat.sendMessage(`কমান্ড পাওয়া যায়নি। ${PREFIX}menu লেখো।`);
    }
  } catch (error) {
    console.error("Message error:", error.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Health server listening on ${PORT}`);
});

client.initialize();
