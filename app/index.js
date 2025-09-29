const { Client, GatewayIntentBits, ChannelType, Partials, PermissionsBitField, MessageFlag, ModalBuilder,TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

const newrole = '1312821331204640818';
// ロールIDを指定
const neochiMenRoleId = '1326398991486681170';  // ここに寝落ち・男ロールのIDを指定
const neochiWomenRoleId = '1326078402330890240';  // ここに寝落ち・女ロールのIDを指定
const chatRoleId = '1322953584882745354';  // ここに雑談ロールのIDを指定

const token = process.env.TOKEN;
const bot = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./recruitments.db');

// テーブル作成（存在しない場合のみ）
db.run(`CREATE TABLE IF NOT EXISTS recruitments (
    channel_id TEXT PRIMARY KEY,
    creator TEXT,
    applicants TEXT,
    notify_channel TEXT
)`);

// Map の初期化が必要
const recruitmentData = new Map();

db.all("SELECT * FROM recruitments", (err, rows) => {
    if (err) {
        console.error("データベースの読み込みに失敗:", err);
        return;
    }
    rows.forEach(row => {
        recruitmentData.set(row.channel_id, {
            creator: row.creator,
            applicants: JSON.parse(row.applicants),
            notifyChannelId: row.notify_channel
        });
    });
    console.log("✅ データベースから募集データをロードしました");
});


function saveRecruitmentData(channelId, data) {
    db.run(
        "INSERT OR REPLACE INTO recruitments (channel_id, creator, applicants, notify_channel) VALUES (?, ?, ?, ?)", 
        [channelId, data.creator, JSON.stringify(data.applicants), data.notifyChannelId || ""]
    );
}

function getRecruitmentData(channelId, callback) {
    db.get("SELECT * FROM recruitments WHERE channel_id = ?", [channelId], (err, row) => {
        if (err) {
            console.error("Database error:", err);
            callback(null);
            return;
        }
        if (row) {
            callback({
                creator: row.creator,
                applicants: JSON.parse(row.applicants),
                notifyChannelId: row.notify_channel
            });
        } else {
            callback(null);
        }
    });
}

// スラッシュコマンドの登録
bot.once('ready', async () => {
    console.log(`Logged in as ${bot.user.tag}`);

    const commands = [
        new SlashCommandBuilder().setName('rct').setDescription('対象のロールとメッセージを設定し募集します')
            .addRoleOption(option => option.setName('role').setDescription('対象のロール').setRequired(true))
            .addStringOption(option => option.setName('message').setDescription('ひとこと').setRequired(true)),

        new SlashCommandBuilder().setName('dm').setDescription('指定したメンバーとの専用チャンネルを作成します')
            .addUserOption(option => option.setName('user').setDescription('メンションしたいユーザー').setRequired(true)),

        new SlashCommandBuilder().setName('afk').setDescription('指定したユーザーを20秒後にVCから切断します')
            .addUserOption(option => option.setName('member').setDescription('切断するユーザー').setRequired(true)),

        new SlashCommandBuilder().setName('setup_recruitment')
            .setDescription('募集を開始するためのボタンを設置します')
    ];

    await bot.application.commands.set(commands);
    console.log('スラッシュコマンドが登録されました。');
});

const PROFILE_CHANNEL_IDS = ['1304768333404700715', '1304690004936622100', '1305140950233780304'];
const TARGET_VOICE_CHANNEL_IDS = new Set(['1304984659213684766', '1322962478971355177', '1318575926073757767', '1326200687259811932', '1304676960634540083', '1326411329644269740', '1307628380237336619', '1316370623705907232', '1317838636519002162', '1326397202628608050']);
const NOTIFICATION_CHANNEL_ID = '1326404192998264853';


bot.on('voiceStateUpdate', async (oldState, newState) => {
                const member = newState.member;

                if (member.user.bot) {
                    // ボイスチャンネルに入室
                    if (oldState.channelId !== newState.channelId && newState.channel) {
                        const channel = newState.channel;
                        if (channel.userLimit !== 0) { // 人数制限が設定されている場合のみ
                            const newLimit = channel.userLimit + 1;
                            await channel.edit({ userLimit: newLimit });
                            console.log(`人数制限を増加: ${channel.name} -> ${newLimit}`);
                        }
                    }

                    // ボイスチャンネルから退室
                    if (oldState.channelId !== newState.channelId && oldState.channel) {
                        const channel = oldState.channel;
                        if (channel.userLimit > 0) {
                            let newLimit = Math.max(0, channel.userLimit - 1);
                            if (newLimit === 0) newLimit = null; // 無制限にする
                            await channel.edit({ userLimit: newLimit });
                            console.log(`人数制限を減少: ${channel.name} -> ${newLimit}`);
                        }
                    }
                } else {
            // ユーザーが対象のボイスチャンネルに「参加したとき」のみ通知を送る
            if (
                oldState.channelId !== newState.channelId && // チャンネルの移動がある場合のみ
                newState.channel &&
                TARGET_VOICE_CHANNEL_IDS.has(newState.channelId)
            ) {
                let profileLink = null;
                const guild = member.guild;

                for (const channelId of PROFILE_CHANNEL_IDS) {
                    const profileChannel = guild.channels.cache.get(channelId);
                    if (!profileChannel) {
                        console.log(`プロフィールチャンネル (ID: ${channelId}) が見つかりません。`);
                        continue;
                    }

                    try {
                        const messages = await profileChannel.messages.fetch({ limit: 100 });
                        const profileMessage = messages.find(msg => msg.author.id === member.id);

                        if (profileMessage) {
                            profileLink = profileMessage.url;
                            break;
                        }
                    } catch (error) {
                        console.error(`メッセージ取得エラー: ${error}`);
                    }
                }

                const notificationChannel = guild.channels.cache.get(NOTIFICATION_CHANNEL_ID);
                if (!notificationChannel) {
                    console.log("通知チャンネルが見つかりません。");
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor(profileLink ? 0x00FF00 : 0xFF0000) // プロフィールあり: 緑 / なし: 赤
                    .setTitle('🎉 VC参加通知！')
                    .setDescription(`**${member.displayName}**\n➡️ **${newState.channel.name}** `)
                    .setThumbnail(member.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                if (profileLink) {
                    embed.addFields({ name: '📌 プロフィールリンク', value: `[クリックして確認](${profileLink})` });
                } else {
                    embed.addFields({ name: '⚠ 不明なプロフィール', value: '-# プロフィールの登録をお願いします。' });
                }

                await notificationChannel.send({ embeds: [embed] });
            }
        }
    });

bot.on('interactionCreate', async (interaction) => {
    if (interaction.guild === null) {
        // DM でコマンドを使用した場合、メッセージを返して終了
        await interaction.reply({ content: "このコマンドはDMでは使用できません。", flags: 64 });
        return;
    }
});

// 寝落ち募集・個通募集ボタンが押されたときの処理
bot.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'open_neochi_modal') {
      const modal = new ModalBuilder()
          .setCustomId('recruit_modal_neochi_recruit')
          .setTitle('寝落ち募集');

      const messageInput = new TextInputBuilder()
          .setCustomId('message')
          .setLabel('ひとことメッセージ')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(messageInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
  } else if (interaction.customId === 'open_kotsu_modal') {
      const modal = new ModalBuilder()
          .setCustomId('recruit_modal_kotsu_recruit')
          .setTitle('個通募集');

      const messageInput = new TextInputBuilder()
          .setCustomId('message')
          .setLabel('ひとことメッセージ')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

      const actionRow = new ActionRowBuilder().addComponents(messageInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
  }
});

// モーダルの送信処理
bot.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  const messageText = interaction.fields.getTextInputValue('message');

  const neochiMenRole = interaction.guild.roles.cache.get(neochiMenRoleId);
  const neochiWomenRole = interaction.guild.roles.cache.get(neochiWomenRoleId);
  const chatRole = interaction.guild.roles.cache.get(chatRoleId);

  let targetRole = null;

  if (interaction.customId === 'recruit_modal_neochi_recruit') {
    // 寝落ちロールが両方ともある場合
    if (interaction.member.roles.cache.has(neochiWomenRoleId) && interaction.member.roles.cache.has(neochiMenRoleId)) {
        return interaction.reply({ content: '❌ あなたは寝落ち募集を作成する資格がありません。どちらか一方のロールにのみ参加してください！', flags: 64 });
    }

    // 寝落ち・女ロールを持っている場合
    if (interaction.member.roles.cache.has(neochiWomenRoleId)) {
        targetRole = neochiMenRole;
    } 
    // 寝落ち・男ロールを持っている場合
    else if (interaction.member.roles.cache.has(neochiMenRoleId)) {
        targetRole = neochiWomenRole;
    } 
    // 両方のロールを持っていない場合
    else {
        return interaction.reply({ content: '❌ あなたは寝落ち募集を作成できません！', flags: 64 });
    }
  } else if (interaction.customId === 'recruit_modal_kotsu_recruit') {
    targetRole = chatRole;
  }


  // targetRoleが設定されていれば、そのロールに関連する処理を続ける
  if (targetRole) {
      // ここで、targetRoleを使用して、必要な処理を行う（例：募集チャンネルの作成など）
      console.log(`対象ロール: ${targetRole}`);
  }

  if (!targetRole) {
      return interaction.reply({ content: '❌ 送信先のロールが見つかりません！', flags: 64 });
  }

　await interaction.deferReply({ flags: 64 });

  // 「募集一覧」カテゴリを取得
  const recruitmentCategory = interaction.guild.channels.cache.find(c => c.name === '募集一覧' && c.type === ChannelType.GuildCategory);
  if (!recruitmentCategory) {
      return interaction.reply({ content: '❌ 「募集一覧」カテゴリが見つかりません。', flags: 64 });
  }

  // チャンネル作成
  const recruitmentChannel = await interaction.guild.channels.create({
      name: `募集-${targetRole.name}`,
      type: ChannelType.GuildText,
      parent: recruitmentCategory.id,
      topic: messageText,
      permissionOverwrites: [
          { 
              id: interaction.guild.id, 
              deny: [
                  PermissionsBitField.Flags.ViewChannel, // 全員に対して閲覧不可
                  PermissionsBitField.Flags.SendMessages // 全員に対して書き込み不可
              ] 
          },
          { id: targetRole.id, allow: [PermissionsBitField.Flags.ViewChannel] },
          { id: newrole, deny: [PermissionsBitField.Flags.ViewChannel] }, // newroleを持っていたら閲覧不可
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
      ]
  });

  const data = {
    creator: interaction.user.id,
    applicants: [],
    notifyChannelId: null
  };

  // データをキャッシュ（Map）に保存
  recruitmentData.set(recruitmentChannel.id, data);

  // データベースにも保存
  saveRecruitmentData(recruitmentChannel.id, data);

  const applyButton = new ButtonBuilder().setCustomId('apply').setLabel('応募する').setStyle(ButtonStyle.Success);
  const deleteButton = new ButtonBuilder().setCustomId('delete').setLabel('募集を削除する').setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder().addComponents(applyButton, deleteButton);

  // プロフィールリンクの取得
  let profileLink = null;
  const member = interaction.user;
  const guild = interaction.guild;

  // プロフィールチャンネルをループして検索
  for (const channelId of PROFILE_CHANNEL_IDS) {
      const profileChannel = guild.channels.cache.get(channelId);
      if (!profileChannel) {
          console.log(`プロフィールチャンネル (ID: ${channelId}) が見つかりません。`);
          continue;
      }

      try {
          const messages = await profileChannel.messages.fetch({ limit: 100 });
          const profileMessage = messages.find(msg => msg.author.id === member.id);

          if (profileMessage) {
              profileLink = profileMessage.url;
              break;
          }
      } catch (error) {
          console.error(`メッセージ取得エラー: ${error}`);
      }
  }

  // Embedメッセージ作成
  const embed = new EmbedBuilder()
      .setColor(profileLink ? 0x00FF00 : 0xFF0000)
      .setTitle('📝 **ひとことメッセージ**')
      .setDescription(`${messageText}\n\n`)
      .setImage(interaction.member.displayAvatarURL({ size: 128 }))
      .setTimestamp()
      .setFooter({
          text: '下記の「応募する」ボタンから！',
          iconURL: 'https://cdn-icons-png.flaticon.com/512/1828/1828817.png'
      });
  if (profileLink) {
    embed.addFields({ name: '📌 プロフィールリンク', value: `[クリックして確認](${profileLink})` });
  } else {
    embed.addFields({ name: '⚠ 不明なプロフィール', value: '-# プロフィールの登録をお願いします。' });
  }

  await recruitmentChannel.send({
      content: `📢 **<@${interaction.user.id}> から ${targetRole.toString()} 宛の募集**`,
      embeds: [embed],
      components: [row]
  });

    await interaction.editReply({ content: `✅ 募集チャンネル ${recruitmentChannel} を作成しました！`, flags: 64 });
});

// ボタン設置用コマンド
bot.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'setup_recruitment') {
      const neochiButton = new ButtonBuilder()
          .setCustomId('open_neochi_modal')
          .setLabel('寝落ち募集')
          .setStyle(ButtonStyle.Primary);

      const kotsuButton = new ButtonBuilder()
          .setCustomId('open_kotsu_modal')
          .setLabel('個通募集')
          .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(neochiButton, kotsuButton);

      await interaction.reply({ 
        content: 'パネルを設置しました！', 
        flags: 64 // 非表示フラグ (ephemeral)
      });

      await interaction.channel.send({ content: '募集を開始するには以下のボタンを押してください！', components: [row] });
  }
});

// 2. /dm コマンド: 専用チャンネルを作成

bot.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.commandName === 'dm') {
                if (interaction.guild === null) {
                    // DM でのメッセージを受け取った場合は処理をスキップ
                    console.log('DMメッセージは無視されました。');
                    return;
                }

                const user = interaction.options.getUser('user');

                // ユーザーが無効または同一の場合はエラーメッセージを表示
                if (!user || user.id === interaction.user.id) {
                    return interaction.reply({ content: "❌ 無効なユーザーです。", flags: 64 });
                }

                // ユーザーがBotの場合はエラーメッセージを表示
                if (user.bot) {
                    return interaction.reply({ content: "❌ BotにはDMを送ることができません。", flags: 64 });
                }

                // DMカテゴリを取得
                const dmCategory = interaction.guild.channels.cache.find(c => c.name === 'DM' && c.type === ChannelType.GuildCategory);
                if (!dmCategory) {
                    return interaction.reply({ content: '❌ DMカテゴリが見つかりません。', flags: 64 });
                }

                // チャンネル名をサーバーニックネーム（またはユーザー名）を使って作成
                const userMember = await interaction.guild.members.fetch(interaction.user.id); // コマンドを実行したユーザーのメンバー情報
                const userNicknameInServer = userMember.nickname || userMember.user.username; // サーバーニックネーム（なければユーザー名）

                // 相手ユーザーのサーバーニックネームを取得
                const targetUser = interaction.guild.members.cache.get(user.id);
                const targetUserNicknameInServer = targetUser.nickname || targetUser.user.username;

                // チャンネル名を作成（コマンド実行者とターゲットのサーバーニックネームを使用）
                const dmChannelName = `dm-${userNicknameInServer}-${targetUserNicknameInServer}`;

                // チャンネル作成
                const dmChannel = await interaction.guild.channels.create({
                    name: dmChannelName, // サーバーニックネームを使ったチャンネル名
                    parent: dmCategory.id,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                    ]
                });

        // チャンネル削除ボタン
        const deleteButton = new ButtonBuilder()
            .setCustomId(`delete_dm_${dmChannel.id}`)
            .setLabel('チャンネル削除')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(deleteButton);

        // DMチャンネル初回メッセージ
        await dmChannel.send({
            content: `🔒 このチャンネルは<@${interaction.user.id}> と <@${user.id}> の専用チャンネルです。`,
            components: [row]
        });

        // 応答メッセージ
        await interaction.reply({ content: `✅ DMチャンネル ${dmChannel} を作成しました！`, flags: 64 });
    }
});

// チャンネル削除ボタンの処理
bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('delete_dm_')) {
        const dmChannelId = interaction.customId.split('_')[2];
        const dmChannel = await interaction.guild.channels.fetch(dmChannelId);

        if (!dmChannel) {
            return interaction.reply({ content: '❌ このチャンネルはすでに削除されているか存在しません。', flags: 64 });
        }

        // 確認メッセージを送信
        await interaction.reply({
            content: `❓ **${dmChannel.name} を削除しますか？**\n-# 削除を確定する場合は「はい」、キャンセルする場合は「いいえ」を押してください。`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`confirm_delete_${dmChannel.id}`).setLabel('はい').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`cancel_delete_${dmChannel.id}`).setLabel('いいえ').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64
        });
    }

    // チャンネル削除の確認ボタン処理
    if (interaction.customId.startsWith('confirm_delete_')) {
        const dmChannelId = interaction.customId.split('_')[2];
        const dmChannel = await interaction.guild.channels.fetch(dmChannelId);

        if (!dmChannel) {
            return interaction.reply({ content: '❌ このチャンネルはすでに削除されているか存在しません。', flags: 64 });
        }

        try {
            // チャンネルを削除
            await dmChannel.delete();
        } catch (error) {
            console.error("❌ メッセージの更新に失敗しました:", error);
            await interaction.reply({ content: '❌ チャンネル削除の処理中にエラーが発生しました。', flags: 64 });
        }

    }

    // チャンネル削除キャンセル処理
    if (interaction.customId.startsWith('cancel_delete_')) {
        await interaction.update({
            content: `❌ DMチャンネルの削除がキャンセルされました。`,
            components: [] // ボタンを削除
        });
    }
});

// 3. /rct コマンド：ロールごとの募集チャンネル作成
bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'rct') {
        if (interaction.guild === null) {
            // DMでのメッセージを受け取った場合は処理をスキップ
            console.log('DMメッセージは無視されました。');
            return;
        }

        const role = interaction.options.getRole('role');
        console.log(role); // デバッグ用に出力
        if (!role) {
            return interaction.reply({ content: "❌ 役職が指定されていません。", flags: 64 });
        }

        const messageText = interaction.options.getString('message');

        // 「募集一覧」カテゴリを取得
        const recruitmentCategory = interaction.guild.channels.cache.find(c => c.name === '募集一覧' && c.type === ChannelType.GuildCategory);
        if (!recruitmentCategory) {
            return interaction.reply({ content: '❌ 「募集一覧」カテゴリが見つかりません。', flags: 64 });
        }

        // 募集チャンネル作成
        const recruitmentChannel = await interaction.guild.channels.create({
            name: `募集-${role.name}`,
            type: ChannelType.GuildText,
            parent: recruitmentCategory.id,
            topic: messageText,
            permissionOverwrites: [
                { 
                    id: interaction.guild.id, 
                    deny: [
                        PermissionsBitField.Flags.ViewChannel, // 全員に対して閲覧不可
                        PermissionsBitField.Flags.SendMessages // 全員に対して書き込み不可
                    ] 
                },
                { id: newrole, deny: [PermissionsBitField.Flags.ViewChannel] }, // newroleを持っていたら閲覧不可
                { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }, // roleを持っていたら閲覧OK
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] } // コマンド実行者は閲覧OK
            ]

        });

        const data = {
            creator: interaction.user.id,
            applicants: [],
            notifyChannelId: null
        };

        // データをキャッシュ（Map）に保存
        recruitmentData.set(recruitmentChannel.id, data);

        // データベースにも保存
        saveRecruitmentData(recruitmentChannel.id, data);

        const applyButton = new ButtonBuilder().setCustomId('apply').setLabel('応募する').setStyle(ButtonStyle.Success);
        const deleteButton = new ButtonBuilder().setCustomId('delete').setLabel('募集を削除する').setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(applyButton, deleteButton);

        // プロフィールリンクの取得
        let profileLink = null;
        const member = interaction.user;
        const guild = interaction.guild;

        // プロフィールチャンネルをループして検索
        for (const channelId of PROFILE_CHANNEL_IDS) {
            const profileChannel = guild.channels.cache.get(channelId);
            if (!profileChannel) {
                console.log(`プロフィールチャンネル (ID: ${channelId}) が見つかりません。`);
                continue;
            }

            try {
                const messages = await profileChannel.messages.fetch({ limit: 100 });
                const profileMessage = messages.find(msg => msg.author.id === member.id);

                if (profileMessage) {
                    profileLink = profileMessage.url;
                    break;
                }
            } catch (error) {
                console.error(`メッセージ取得エラー: ${error}`);
            }
        }

        // Embedの作成
        const embed = new EmbedBuilder()
            .setColor(profileLink ? 0x00FF00 : 0xFF0000) // プロフィールあり: 緑 / なし: 赤
            .setTitle(`📝 **ひとこと**`) // messageTextをタイトルに設定
            .setDescription(`${messageText}\n\n`)  // 空行を追加して余白を確保
            .setImage(interaction.member.displayAvatarURL({ size: 128 }))
            .setTimestamp()
            .setFooter({
                text: "下記の「応募する」ボタンから！",
                iconURL: "https://cdn-icons-png.flaticon.com/512/1828/1828817.png"
            });

        if (profileLink) {
            embed.addFields({ name: '📌 プロフィールリンク', value: `[クリックして確認](${profileLink})` });
        } else {
            embed.addFields({ name: '⚠ 不明なプロフィール', value: '-# プロフィールの登録をお願いします。' });
        }

        // メッセージ送信
        await recruitmentChannel.send({
            content: `📢 **<@${interaction.user.id}> から ${role.toString()} 宛の募集**`,
            embeds: [embed],
            components: [row]
        });

        await interaction.reply({ content: `✅ 募集チャンネル ${recruitmentChannel} を作成しました！`, flags: 64 });
    }
});


bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'apply') {
        const recruitmentChannel = interaction.channel;

        // 最初にキャッシュを取得
        let data = recruitmentData.get(recruitmentChannel.id);

        if (!data) {
            // 非同期でデータを取得
            try {
                data = await new Promise((resolve, reject) => {
                    getRecruitmentData(recruitmentChannel.id, (dbData) => {
                        if (!dbData) {
                            reject('❌ この募集情報は存在しません。');
                        }
                        resolve(dbData);
                    });
                });

                // データをキャッシュに保存
                recruitmentData.set(recruitmentChannel.id, data);
            } catch (error) {
                return interaction.reply({ content: error, flags: 64 });
            }
        }

        if (interaction.member.roles.cache.has(newrole)) {
            return interaction.reply({ content: '❌ あなたはこの募集に応募できません！', flags: 64 });
        }
        // 応募者がすでに応募しているかチェック
        if (data.applicants.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ すでに応募済みです！', flags: 64 });
        }

        // 応募者を追加
        data.applicants.push(interaction.user.id);

        // DBに保存
        saveRecruitmentData(recruitmentChannel.id, data);

        // 募集者情報を取得
        const creator = await interaction.guild.members.fetch(data.creator);

        // 応募通知カテゴリの取得
        const notifyCategory = interaction.guild.channels.cache.find(c => c.name === '応募通知' && c.type === ChannelType.GuildCategory);
        if (!notifyCategory) {
            return interaction.reply({ content: '❌ 「応募通知」カテゴリが見つかりません。', flags: 64 });
        }

        // 通知チャンネルの作成または取得
        let notifyChannel = data.notifyChannelId ? interaction.guild.channels.cache.get(data.notifyChannelId) : null;
        if (!notifyChannel) {
            notifyChannel = await interaction.guild.channels.create({
                name: `${creator.user.username}-応募通知`,
                type: ChannelType.GuildText,
                parent: notifyCategory.id,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: data.creator, allow: [PermissionsBitField.Flags.ViewChannel] }
                ]
            });

            data.notifyChannelId = notifyChannel.id;
            recruitmentData.set(recruitmentChannel.id, data);
            saveRecruitmentData(recruitmentChannel.id, data);

            await notifyChannel.send({
                content: `✅ 応募者リスト専用チャンネルが作成されました！\n\n📌 **募集チャンネル**: <#${recruitmentChannel.id}>`
            });
        }

        // 応募者リストの更新
        const applicantList = data.applicants.map(id => `- <@${id}>`).join('\n');
        await notifyChannel.send({
            content: `📩 **新しい応募者:** <@${interaction.user.id}>\n\n現在の応募者リスト:\n${applicantList}`
        });

        await interaction.reply({ content: '✅ 応募が完了しました！', flags: 64 });
    }
});




bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'delete') {
        const recruitmentChannel = interaction.channel;
        const data = recruitmentData.get(recruitmentChannel.id);
        if (!data) {
            return interaction.reply({ content: '❌ この募集情報は存在しません。', flags: 64 });
        }

        if (interaction.user.id !== data.creator) {
            return interaction.reply({ content: '❌ あなたにはこの募集を削除する権限がありません。', flags: 64 });
        }

        await interaction.reply({
            content: '**❓ 募集と応募通知チャンネルを削除しますか？**\n-# 削除を確定する場合は「はい」、キャンセルする場合は「いいえ」を押してください。',
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_delete').setLabel('はい').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('cancel_delete').setLabel('いいえ').setStyle(ButtonStyle.Secondary)
                )
            ],
            flags: 64,
        });
    }

    if (interaction.customId === 'confirm_delete') {
        const recruitmentChannel = interaction.channel;
        const data = recruitmentData.get(recruitmentChannel.id);

        if (data.notifyChannelId) {
            const notifyChannel = interaction.guild.channels.cache.get(data.notifyChannelId);
            if (notifyChannel) {
                await notifyChannel.delete();
            }
        }

        // データベースから削除
        db.run("DELETE FROM recruitments WHERE channel_id = ?", [recruitmentChannel.id], (err) => {
            if (err) {
                console.error("データベース削除エラー:", err);
            }
        });

        // チャンネル削除とMapからの削除
        await recruitmentChannel.delete();
        recruitmentData.delete(recruitmentChannel.id);  // Map からデータ削除

    }

    if (interaction.customId === 'cancel_delete') {
        await interaction.update({
            content: '❌ 募集削除がキャンセルされました。',
            components: [] // ボタンを削除
        });
    }
});




// 4. /afk コマンド：指定ユーザーを 20 秒後にVC切断
bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return

    if (interaction.commandName === 'afk') {
        if (interaction.guild === null) {
            // DM でのメッセージを受け取った場合は処理をスキップ
            console.log('DMメッセージは無視されました。');
            return;
        }
        const member = interaction.options.getMember('member');

        if (!member.voice.channel) {
            return interaction.reply({ content: '❌ 指定したユーザーはVCにいません。', flags: 64 });
        }

        // キャンセルボタン
        const cancelButton = new ButtonBuilder()
            .setCustomId(`cancel_afk_${member.id}`)
            .setLabel('キャンセル')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(cancelButton);

        // メッセージ送信
        let countdown = 20;
        await interaction.reply({ 
            content: `🔴 **<@${member.id}>** は ${countdown} 秒後にVCから切断されます。\nキャンセルする場合は以下のボタンを押してください。`, 
            components: [row]
        });

        const message = await interaction.fetchReply(); // メッセージを取得

        let isCancelled = false; // キャンセルフラグ

        const interval = setInterval(async () => {
            countdown--;
            if (countdown > 0) {
                await message.edit({ content: `🔴 **<@${member.id}>** は ${countdown} 秒後にVCから切断されます。\nキャンセルする場合は以下のボタンを押してください。` });
            } else {
                // 20秒経過後にボタンが押されなければ切断処理
                clearInterval(interval);
                if (!isCancelled) {
                    await message.edit({ content: `⏳ **<@${member.id}>** をVCから切断しました。`, components: [] });
                    if (member.voice.channel) {
                        await member.voice.disconnect();
                    }
                }
            }
        }, 1000);

        // ボタンの処理
        const filter = (i) => i.customId === `cancel_afk_${member.id}`;
        const collector = message.createMessageComponentCollector({ filter, time: 20000 });

        collector.on('collect', async (i) => {
            if (i.user.id !== member.id) {
                await i.reply({ content: '❌ あなたはこの操作をキャンセルする権限がありません。', flags: 64 });
                return;
            }

            // キャンセルボタンが押された場合、タイマーを止めてキャンセル
            isCancelled = true; // キャンセルフラグを立てる
            clearInterval(interval);
            await i.update({ content: `✅ **${member.displayName}** は切断をキャンセルしました！`, components: [] });
        });

        collector.on('end', async (collected, reason) => {
            // 時間切れであり、キャンセルされていない場合
            if (reason === 'time' && !isCancelled) {
                clearInterval(interval);

                try {
                    await message.edit({ 
                        content: `⏳ **${member.displayName}** をVCから切断しました。`, 
                        components: [] 
                    });
                } catch (error) {
                    console.error("メッセージの編集に失敗しました:", error);
                }

                // メンバーがVCにまだいるか、ボットがキックできるかを確認
                if (member.voice.channel && member.kickable) {
                    try {
                        await member.voice.disconnect();
                    } catch (error) {
                        console.error("VC からの切断に失敗しました:", error);
                    }
                }
            }
        });

    }
});

// Botログイン
bot.login(token);
