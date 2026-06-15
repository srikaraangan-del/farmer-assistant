import { useState, useRef, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Phone,
  Send,
  User,
  Bot,
  Sparkles,
  CheckCircle,
  Loader2,
} from "lucide-react";

interface ChatMessage {
  id: number;
  sender: "farmer" | "ai";
  content: string;
  intent?: string;
  language: string;
  timestamp: Date;
}

export default function WhatsAppSimulator() {
  const [phoneNumber, setPhoneNumber] = useState("+91 98765 43210");
  const [language, setLanguage] = useState<"english" | "hindi" | "telugu">("english");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      sender: "ai",
      content:
        "Hello! Welcome to AI Farmer Assistant.\n\nI can help you with:\n- Weather updates\n- Market prices\n- Government schemes\n- Farming advice\n\nWhat would you like to know?",
      language: "english",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [nextId, setNextId] = useState(2);
  const scrollRef = useRef<HTMLDivElement>(null);

  const receiveMutation = trpc.whatsapp.receiveMessage.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId,
          sender: "ai",
          content: data.aiResponse,
          intent: data.intent,
          language: data.language,
          timestamp: new Date(),
        },
      ]);
      setNextId((n) => n + 1);
    },
  });

  const simulateMutation = trpc.whatsapp.simulateResponse.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId,
          sender: "ai",
          content: data.aiResponse,
          intent: data.intent,
          language: data.language,
          timestamp: new Date(),
        },
      ]);
      setNextId((n) => n + 1);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = {
      id: nextId,
      sender: "farmer",
      content: input.trim(),
      language,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setNextId((n) => n + 1);
    setInput("");

    // Use simulation for quick testing without DB
    simulateMutation.mutate({ message: input.trim(), language });
  };

  const quickReplies = [
    { label: "Weather", text: "What is the weather today?" },
    { label: "Rice Price", text: "What is the price of rice?" },
    { label: "Schemes", text: "Tell me about government schemes" },
    { label: "Fertilizer", text: "What fertilizer should I use for paddy?" },
    { label: "Namaste", text: "Namaste" },
  ];

  const { data: status } = trpc.whatsapp.status.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp Simulator</h1>
        <p className="text-muted-foreground mt-1">
          Test the AI assistant by simulating farmer messages
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat Window */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 bg-green-500 rounded-full flex items-center justify-center">
                  <Phone className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-base">WhatsApp Chat</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {status?.status === "active" ? (
                      <span className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        Webhook active
                      </span>
                    ) : (
                      "Checking status..."
                    )}
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="capitalize">
                {language}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Messages */}
            <div
              ref={scrollRef}
              className="h-[450px] overflow-y-auto p-4 space-y-4 bg-muted/20"
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    msg.sender === "farmer" ? "flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.sender === "farmer" ? "bg-blue-100" : "bg-green-100"
                    }`}
                  >
                    {msg.sender === "farmer" ? (
                      <User className="h-4 w-4 text-blue-600" />
                    ) : (
                      <Bot className="h-4 w-4 text-green-600" />
                    )}
                  </div>
                  <div
                    className={`max-w-[75%] rounded-lg p-3 text-sm ${
                      msg.sender === "farmer"
                        ? "bg-blue-500 text-white"
                        : "bg-white border shadow-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.intent && (
                      <span
                        className={`text-[10px] mt-1 inline-block px-1.5 py-0.5 rounded ${
                          msg.sender === "farmer"
                            ? "bg-blue-600 text-white"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {msg.intent}
                      </span>
                    )}
                    <p
                      className={`text-[10px] mt-1 ${
                        msg.sender === "farmer"
                          ? "text-blue-200"
                          : "text-muted-foreground"
                      }`}
                    >
                      {msg.timestamp.toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
              {(simulateMutation.isPending || receiveMutation.isPending) && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI is thinking...
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-3 border-t bg-background">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  className="flex-1"
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || simulateMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Controls */}
        <div className="space-y-4">
          {/* Phone & Language */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Simulation Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Phone Number</label>
                <Input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Language</label>
                <Select
                  value={language}
                  onValueChange={(v) =>
                    setLanguage(v as "english" | "hindi" | "telugu")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="english">English</SelectItem>
                    <SelectItem value="hindi">Hindi</SelectItem>
                    <SelectItem value="telugu">Telugu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Quick Replies */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick Replies</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickReplies.map((qr) => (
                <Button
                  key={qr.label}
                  variant="outline"
                  className="w-full justify-start text-sm"
                  onClick={() => {
                    const userMsg: ChatMessage = {
                      id: nextId,
                      sender: "farmer",
                      content: qr.text,
                      language,
                      timestamp: new Date(),
                    };
                    setMessages((prev) => [...prev, userMsg]);
                    setNextId((n) => n + 1);
                    simulateMutation.mutate({ message: qr.text, language });
                  }}
                >
                  {qr.label}
                </Button>
              ))}
            </CardContent>
          </Card>

          {/* Webhook Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Webhook Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant={status?.status === "active" ? "default" : "secondary"}
                >
                  {status?.status ?? "unknown"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Endpoint</span>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                  /api/trpc/whatsapp.receiveMessage
                </code>
              </div>
              <Separator className="my-2" />
              <div className="text-xs text-muted-foreground">
                <strong>Supported:</strong>{" "}
                {status?.supportedContentTypes?.join(", ") ?? "text, voice"}
              </div>
              <div className="text-xs text-muted-foreground">
                <strong>Languages:</strong>{" "}
                {status?.supportedLanguages?.join(", ") ?? "english, hindi, telugu"}
              </div>
              <div className="text-xs text-muted-foreground">
                <strong>Features:</strong>{" "}
                {status?.features?.slice(0, 4).join(", ") ?? "intent detection"}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
