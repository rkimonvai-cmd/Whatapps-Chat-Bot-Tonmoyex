module.exports = (req, res) => {
  res.status(200).json({
    status: "online",
    bot: "GROUP CHAT BOT",
    message: "Vercel API is working"
  });
};
