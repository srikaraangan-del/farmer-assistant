import { relations } from "drizzle-orm";
import {
  farmers,
  conversations,
  messages,
  analyticsEvents,
} from "./schema";

// Farmer relations
export const farmersRelations = relations(farmers, ({ many }) => ({
  conversations: many(conversations),
  messages: many(messages),
  analytics: many(analyticsEvents),
}));

// Conversation relations
export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  farmer: one(farmers, {
    fields: [conversations.farmerId],
    references: [farmers.id],
  }),
  messages: many(messages),
}));

// Message relations
export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  farmer: one(farmers, {
    fields: [messages.farmerId],
    references: [farmers.id],
  }),
}));

// Analytics events relations
export const analyticsEventsRelations = relations(analyticsEvents, ({ one }) => ({
  farmer: one(farmers, {
    fields: [analyticsEvents.farmerId],
    references: [farmers.id],
  }),
  conversation: one(conversations, {
    fields: [analyticsEvents.conversationId],
    references: [conversations.id],
  }),
}));
