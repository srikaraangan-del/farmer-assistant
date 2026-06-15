import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  User,
  Bot,
  Clock,
  Hash,
} from "lucide-react";

export default function Conversations() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedConv, setSelectedConv] = useState<number | null>(null);

  const { data, isLoading } = trpc.conversations.list.useQuery({
    status: statusFilter === "all" ? undefined : (statusFilter as "active" | "closed" | "archived"),
    page,
    limit: 20,
  });

  const { data: convDetail } = trpc.conversations.getById.useQuery(
    { id: selectedConv! },
    { enabled: !!selectedConv }
  );

  const statusColors: Record<string, string> = {
    active: "bg-green-100 text-green-800 border-green-200",
    closed: "bg-gray-100 text-gray-800 border-gray-200",
    archived: "bg-amber-100 text-amber-800 border-amber-200",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conversations</h1>
        <p className="text-muted-foreground mt-1">
          View all chat sessions between farmers and the AI assistant
        </p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversations List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Chat Sessions ({data?.total ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="max-h-[600px] overflow-y-auto">
                  {data?.items.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => setSelectedConv(conv.id)}
                      className={`w-full text-left p-4 border-b hover:bg-muted/50 transition-colors ${
                        selectedConv === conv.id ? "bg-primary/5 border-l-4 border-l-primary" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm truncate">
                          {conv.farmerName ?? conv.farmerPhone ?? "Unknown"}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${statusColors[conv.status] ?? ""}`}
                        >
                          {conv.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          {conv.messageCount} msgs
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {conv.startedAt
                            ? new Date(conv.startedAt).toLocaleDateString("en-IN")
                            : "-"}
                        </span>
                      </div>
                      {conv.intent && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded mt-1 inline-block">
                          {conv.intent}
                        </span>
                      )}
                    </button>
                  ))}
                  {data?.items.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground text-sm">
                      No conversations found
                    </div>
                  )}
                </div>
                {data && data.totalPages > 1 && (
                  <div className="flex items-center justify-between p-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs">
                      {page} / {data.totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                      disabled={page === data.totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Messages */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {selectedConv && convDetail?.conversation
                ? `Conversation #${selectedConv}`
                : "Select a conversation"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedConv ? (
              <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                Select a conversation from the list to view messages
              </div>
            ) : !convDetail ? (
              <div className="h-[500px] flex items-center justify-center">
                <Skeleton className="h-8 w-32" />
              </div>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {convDetail.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${
                      msg.senderType === "farmer" ? "" : "flex-row-reverse"
                    }`}
                  >
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                        msg.senderType === "farmer"
                          ? "bg-blue-100"
                          : msg.senderType === "ai"
                            ? "bg-green-100"
                            : "bg-gray-100"
                      }`}
                    >
                      {msg.senderType === "farmer" ? (
                        <User className="h-4 w-4 text-blue-600" />
                      ) : msg.senderType === "ai" ? (
                        <Bot className="h-4 w-4 text-green-600" />
                      ) : (
                        <MessageSquare className="h-4 w-4 text-gray-600" />
                      )}
                    </div>
                    <div
                      className={`max-w-[80%] rounded-lg p-3 text-sm ${
                        msg.senderType === "farmer"
                          ? "bg-muted"
                          : msg.senderType === "ai"
                            ? "bg-primary/10 text-primary-foreground"
                            : "bg-amber-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium capitalize">
                          {msg.senderType}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {msg.createdAt
                            ? new Date(msg.createdAt).toLocaleTimeString("en-IN")
                            : ""}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.intentDetected && (
                        <span className="text-[10px] bg-background/50 px-1.5 py-0.5 rounded mt-1 inline-block">
                          intent: {msg.intentDetected}
                        </span>
                      )}
                      {msg.contentType === "voice" && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Voice message
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                {convDetail.messages.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    No messages in this conversation
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
