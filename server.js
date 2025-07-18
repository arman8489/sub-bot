// server.js - Main server file
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Discord bot setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// In-memory storage (you'll want to upgrade to a real database later)
const subscriptions = new Map();

// Environment variables you'll need to set:
// DISCORD_BOT_TOKEN - Your bot token
// DISCORD_GUILD_ID - Your server ID
// PREMIUM_ROLE_ID - The role ID for premium users
// WIX_WEBHOOK_SECRET - Secret for verifying Wix webhooks

// Discord bot login
client.login(process.env.DISCORD_BOT_TOKEN);

client.once('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}!`);
});

// Function to assign premium role
async function assignPremiumRole(discordUserId) {
    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const member = await guild.members.fetch(discordUserId);
        const role = await guild.roles.fetch(process.env.PREMIUM_ROLE_ID);
        
        await member.roles.add(role);
        console.log(`Assigned premium role to ${member.user.tag}`);
        return true;
    } catch (error) {
        console.error('Error assigning role:', error);
        return false;
    }
}

// Function to remove premium role
async function removePremiumRole(discordUserId) {
    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const member = await guild.members.fetch(discordUserId);
        const role = await guild.roles.fetch(process.env.PREMIUM_ROLE_ID);
        
        await member.roles.remove(role);
        console.log(`Removed premium role from ${member.user.tag}`);
        return true;
    } catch (error) {
        console.error('Error removing role:', error);
        return false;
    }
}

// Discord OAuth callback endpoint
app.get('/auth/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }

    try {
        // Exchange code for access token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.DISCORD_REDIRECT_URI,
            }),
        });

        const tokenData = await tokenResponse.json();
        
        // Get user info
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
            },
        });

        const userData = await userResponse.json();
        
        // Store user info temporarily (you'll want to improve this)
        const sessionId = Date.now().toString();
        subscriptions.set(sessionId, {
            discordId: userData.id,
            username: userData.username,
            timestamp: Date.now()
        });

        // Redirect back to your website with session ID
        res.redirect(`${process.env.WEBSITE_URL}/checkout?session=${sessionId}`);
        
    } catch (error) {
        console.error('OAuth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Wix webhook endpoint for new purchases
app.post('/webhook/purchase', async (req, res) => {
    try {
        // Verify webhook (implement proper verification in production)
        const signature = req.headers['x-wix-signature'];
        
        const order = req.body;
        console.log('New purchase:', order);
        
        // Get Discord user ID from custom field or session
        const discordUserId = order.customFields?.discordUserId || order.discordUserId;
        
        if (!discordUserId) {
            console.error('No Discord user ID found in order');
            return res.status(400).json({ error: 'No Discord user ID' });
        }

        // Assign premium role
        const success = await assignPremiumRole(discordUserId);
        
        if (success) {
            // Store subscription info
            subscriptions.set(order.id, {
                discordId: discordUserId,
                orderId: order.id,
                status: 'active',
                createdAt: new Date()
            });
            
            res.json({ success: true, message: 'Role assigned successfully' });
        } else {
            res.status(500).json({ error: 'Failed to assign role' });
        }
        
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Wix webhook endpoint for subscription cancellations
app.post('/webhook/cancellation', async (req, res) => {
    try {
        const order = req.body;
        console.log('Subscription cancelled:', order);
        
        // Find subscription by order ID
        const subscription = subscriptions.get(order.id);
        
        if (!subscription) {
            console.error('Subscription not found');
            return res.status(404).json({ error: 'Subscription not found' });
        }

        // Remove premium role
        const success = await removePremiumRole(subscription.discordId);
        
        if (success) {
            // Update subscription status
            subscription.status = 'cancelled';
            subscription.cancelledAt = new Date();
            
            res.json({ success: true, message: 'Role removed successfully' });
        } else {
            res.status(500).json({ error: 'Failed to remove role' });
        }
        
    } catch (error) {
        console.error('Cancellation webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        bot: client.user ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Get Discord auth URL
app.get('/auth/discord', (req, res) => {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
    res.json({ authUrl });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
