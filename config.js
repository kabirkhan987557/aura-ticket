require("dotenv").config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  staffRoleId: process.env.STAFF_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  logChannelId: process.env.LOG_CHANNEL_ID,
  minInvites: Number(process.env.MIN_INVITES || 5),
  lowInviteCloseMs: Number(process.env.LOW_INVITE_CLOSE_MS || 5000)
};
