// discord-recruit-bot.js
// Node.js v18 用
// 修正点:
// 1. 管理者がスラッシュコマンドで固定の募集ボタンを設置（無期限利用可）
// 2. 募集投稿先チャンネルは固定（環境変数 RECRUIT_CHANNEL_ID）
// 3. 応募ボタンを押すと募集者に DM 通知 → DM で承認ボタン → 応募者に通知


require('dotenv').config();
const {
Client,
GatewayIntentBits,
SlashCommandBuilder,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
ModalBuilder,
TextInputBuilder,
TextInputStyle,
Events,
PermissionsBitField,
EmbedBuilder
} = require('discord.js');


const TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const RECRUIT_CHANNEL_ID = process.env.RECRUIT_CHANNEL_ID; // 募集投稿先チャンネル固定


if (!TOKEN || !GUILD_ID || !CLIENT_ID || !RECRUIT_CHANNEL_ID) {
console.error('Please set BOT_TOKEN, CLIENT_ID, GUILD_ID, RECRUIT_CHANNEL_ID in .env');
process.exit(1);
}


const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMessages], partials: ['CHANNEL'] });


// スラッシュコマンド: 管理者が募集ボタンを設置
const setupCommand = new SlashCommandBuilder()
.setName('setup-recruit-buttons')
.setDescription('管理者用: ロール宛の募集ボタンを設置します。')
.setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
.addRoleOption(opt => opt.setName('role1').setDescription('ロール1').setRequired(true))
.addRoleOption(opt => opt.setName('role2').setDescription('ロール2'))
.addRoleOption(opt => opt.setName('role3').setDescription('ロール3'));


client.once(Events.ClientReady, async () => {
console.log(`Logged in as ${client.user.tag}`);
try {
const guild = await client.guilds.fetch(GUILD_ID);
await guild.commands.create(setupCommand.toJSON());
console.log('Slash command registered to guild', GUILD_ID);
} catch (err) {
console.error('Failed to register command:', err);
}
});


// 応募リストを一時的に保持
const recruitPosts = new Map(); // messageId -> { creatorId, roleId }


client.on(Events.InteractionCreate, async interaction => {
  try {
    // スラッシュコマンド処理
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-recruit-buttons') {
        const roles = [];
        for (let i = 1; i <= 3; i++) {
          const r = interaction.options.getRole(`role${i}`);
          if (r) roles.push(r);
        }
        if (!roles.length) {
          return interaction.reply({ content: 'ロールを少なくとも1つ指定してください。', ephemeral: true });
        }

        const buttons = roles.map(role =>
          new ButtonBuilder()
            .setCustomId(`openModal:${role.id}`)
            .setLabel(`${role.name} 募集`)
            .setStyle(ButtonStyle.Primary)
        );
        const row = new ActionRowBuilder().addComponents(buttons);

        await interaction.reply({
          content: '募集用のボタンを設置しました！',
          components: [row]
        });
      }
    }

    // ここにボタン処理やモーダル処理も追加していく
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: 'エラーが発生しました。', ephemeral: true }).catch(() => {});
    }
  }
});

// 🚀 最後に1回だけログイン
client.login(TOKEN);
