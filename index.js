const {
  Client, GatewayIntentBits, Partials, PermissionsBitField,
  ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, REST, Routes
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config");

if (!config.token) throw new Error("DISCORD_TOKEN is missing in .env");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ],
  partials: [Partials.Channel]
});

const dataDir = path.join(__dirname, "data");
const transcriptDir = path.join(dataDir, "transcripts");
fs.mkdirSync(transcriptDir, { recursive: true });

const invitesFile = path.join(dataDir, "invites.json");
let inviteData = fs.existsSync(invitesFile)
  ? JSON.parse(fs.readFileSync(invitesFile, "utf8"))
  : {};

function saveInvites() {
  fs.writeFileSync(invitesFile, JSON.stringify(inviteData, null, 2));
}

function getInvites(userId) {
  return inviteData[userId]?.count || 0;
}

/*
  IMPORTANT:
  Discord does not provide a simple "user invite count" field.
  This bot tracks invite usage while it is online and records the inviter
  when Discord exposes it. Invites created before the bot started cannot
  reliably be reconstructed.
*/
async function cacheInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    guild.inviteCache = new Map(invites.map(i => [i.code, i.uses || 0]));
  } catch (e) {
    console.error("Could not fetch invites:", e.message);
  }
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (guild) await cacheInvites(guild);

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, config.guildId),
    { body: [{ name: "ticket", description: "Send the AuraTicket panel" }] }
  );
  console.log("AuraTicket is ready.");
});

client.on("inviteCreate", async invite => {
  const guild = invite.guild;
  if (!guild.inviteCache) guild.inviteCache = new Map();
  guild.inviteCache.set(invite.code, invite.uses || 0);
});

client.on("inviteDelete", async invite => {
  if (invite.guild.inviteCache) invite.guild.inviteCache.delete(invite.code);
});

client.on("guildMemberAdd", async member => {
  try {
    const before = member.guild.inviteCache || new Map();
    const current = await member.guild.invites.fetch();
    const used = current.find(i => {
      const oldUses = before.get(i.code) || 0;
      return (i.uses || 0) > oldUses;
    });

    member.guild.inviteCache = new Map(current.map(i => [i.code, i.uses || 0]));

    if (used?.inviter?.id) {
      const inviterId = used.inviter.id;
      inviteData[inviterId] ??= { count: 0 };
      inviteData[inviterId].count += 1;
      saveInvites();
      console.log(`${member.user.tag} joined through ${used.inviter.tag}`);
    }
  } catch (e) {
    console.error("Invite tracking error:", e.message);
  }
});

async function makeTranscript(channel) {
  const messages = [];
  let lastId;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!batch || batch.size === 0) break;
    messages.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }

  messages.reverse();

  const escape = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[c]
  );

  const html = `<!doctype html>
<html><head><meta charset="utf-8">
<title>${escape(channel.name)} Transcript</title>
<style>
body{font-family:Arial,sans-serif;background:#111;color:#eee;padding:24px}
.msg{padding:10px 0;border-bottom:1px solid #333}
.author{font-weight:bold}.time{color:#888;font-size:12px}.content{margin-top:4px;white-space:pre-wrap}
</style></head><body>
<h1>AuraTicket Transcript</h1>
<h3>${escape(channel.name)}</h3>
${messages.map(m => `<div class="msg">
<div><span class="author">${escape(m.author?.tag || m.author?.username || "Unknown")}</span>
<span class="time">${escape(m.createdAt.toISOString())}</span></div>
<div class="content">${escape(m.content)}</div>
</div>`).join("")}
</body></html>`;

  const file = path.join(transcriptDir, `${channel.id}.html`);
  fs.writeFileSync(file, html);
  return file;
}

async function closeTicket(channel, reason = "Closed") {
  if (!channel || !channel.isTextBased()) return;

  let openerId = channel.topic?.match(/ticketUser:(\d+)/)?.[1];

  let transcript = null;
  try {
    transcript = await makeTranscript(channel);
  } catch (e) {
    console.error("Transcript error:", e.message);
  }

  const log = channel.guild.channels.cache.get(config.logChannelId);
  if (log && transcript) {
    await log.send({
      content: `📄 **Ticket transcript**\n**Channel:** #${channel.name}\n**Reason:** ${reason}`,
      files: [transcript]
    }).catch(console.error);
  }

  if (openerId && transcript) {
    const user = await client.users.fetch(openerId).catch(() => null);
    if (user) {
      await user.send({
        content: `🎫 Your ticket **${channel.name}** has been closed.\n📄 Your transcript is attached below.`,
        files: [transcript]
      }).catch(() => console.log(`Could not DM ${openerId}.`));
    }
  }

  setTimeout(() => channel.delete(`AuraTicket: ${reason}`).catch(console.error), 1500);
}

function ticketPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("🎫 AuraTicket")
        .setDescription(
          `Need support? Click **Create Ticket** below.\n\n` +
          `🔹 Minimum requirement: **${config.minInvites} invites**\n` +
          `🔹 Your invite count is checked automatically.\n` +
          `🔹 Tickets with fewer than ${config.minInvites} invites are automatically closed.`
        )
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("create_ticket")
          .setLabel("Create Ticket")
          .setEmoji("🎫")
          .setStyle(ButtonStyle.Primary)
      )
    ]
  };
}

client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === "ticket") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return interaction.reply({ content: "❌ You need **Manage Server** permission.", ephemeral: true });
    }
    await interaction.channel.send(ticketPanel());
    return interaction.reply({ content: "✅ Ticket panel sent.", ephemeral: true });
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "create_ticket") {
    await interaction.deferReply({ ephemeral: true });

    const count = getInvites(interaction.user.id);
    if (count < config.minInvites) {
      await interaction.editReply(
        `❌ **Ticket denied**\n\n` +
        `You currently have **${count}/${config.minInvites} invites**.\n` +
        `You need **${config.minInvites - count} more invite(s)** to open a ticket.\n\n` +
        `⚠️ This ticket will close automatically.`
      );

      const temp = await interaction.guild.channels.create({
        name: `ticket-denied-${interaction.user.username}`.slice(0, 90),
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId || undefined,
        topic: `ticketUser:${interaction.user.id};denied:true`,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          ...(config.staffRoleId ? [{
            id: config.staffRoleId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          }] : [])
        ]
      });

      await temp.send(`❌ <@${interaction.user.id}> you have **${count}/${config.minInvites} invites**. This ticket will close automatically.`);
      setTimeout(() => closeTicket(temp, "Not enough invites"), config.lowInviteCloseMs);
      return;
    }

    const existing = interaction.guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.topic?.includes(`ticketUser:${interaction.user.id}`)
    );
    if (existing) return interaction.editReply(`⚠️ You already have a ticket: ${existing}`);

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: config.ticketCategoryId || undefined,
      topic: `ticketUser:${interaction.user.id}`,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]},
        ...(config.staffRoleId ? [{
          id: config.staffRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }] : [])
      ]
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@${interaction.user.id}> ${config.staffRoleId ? `<@&${config.staffRoleId}>` : ""}`,
      embeds: [
        new EmbedBuilder()
          .setTitle("🎫 Ticket Opened")
          .setDescription("Please explain your issue. Staff will help you soon.")
          .addFields({ name: "Invites", value: `${count}/${config.minInvites}`, inline: true })
      ],
      components: [row]
    });

    await interaction.editReply(`✅ Your ticket has been created: ${channel}`);
  }

  if (interaction.customId === "close_ticket") {
    const member = interaction.member;
    const isStaff = config.staffRoleId && member.roles.cache.has(config.staffRoleId);
    const isOwner = interaction.channel.topic?.includes(`ticketUser:${interaction.user.id}`);

    if (!isStaff && !isOwner) {
      return interaction.reply({ content: "❌ You cannot close this ticket.", ephemeral: true });
    }

    await interaction.reply("🔒 Closing ticket and creating transcript...");
    await closeTicket(interaction.channel, "Closed by user/staff");
  }
});

client.login(config.token);
