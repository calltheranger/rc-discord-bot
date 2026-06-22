import { Client } from 'discord.js';
export interface ChannelHistory {
    channelName: string;
    messages: string[];
}
export declare const getDailyHistory: (client: Client) => Promise<ChannelHistory[]>;
export declare const summarizeDailyHistory: (history: ChannelHistory[]) => Promise<string>;
export declare const executeDailySummary: (client: Client, overrideChannelId?: string) => Promise<void>;
//# sourceMappingURL=summarizer.d.ts.map