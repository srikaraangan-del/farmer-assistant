import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Newspaper,
  Send,
  Users,
  CheckCircle,
  AlertCircle,
  Loader2,
  Eye,
  ChevronLeft,
  ChevronRight,
  Clock,
  Sun,
  TrendingUp,
  Landmark,
  Sprout,
  Smartphone,
  Radio,
} from "lucide-react";

export default function DailyBriefings() {
  const [selectedFarmerId, setSelectedFarmerId] = useState<number | null>(null);
  const [previewTab, setPreviewTab] = useState("preview");
  const [sendingSingle, setSendingSingle] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [page, setPage] = useState(1);

  const utils = trpc.useUtils();

  const { data: stats } = trpc.briefings.stats.useQuery();
  const { data: history } = trpc.briefings.list.useQuery({
    page,
    limit: 20,
  });
  const { data: farmersList } = trpc.farmers.list.useQuery({
    isActive: true,
    limit: 100,
  });

  const { data: preview, isLoading: previewLoading } =
    trpc.briefings.generate.useQuery(
      { farmerId: selectedFarmerId! },
      { enabled: !!selectedFarmerId }
    );

  const sendMutation = trpc.briefings.send.useMutation({
    onSuccess: () => {
      utils.briefings.list.invalidate();
      utils.briefings.stats.invalidate();
      setSendingSingle(false);
    },
    onError: () => setSendingSingle(false),
  });

  const sendAllMutation = trpc.briefings.sendToAll.useMutation({
    onSuccess: () => {
      utils.briefings.list.invalidate();
      utils.briefings.stats.invalidate();
      setSendingAll(false);
    },
    onError: () => setSendingAll(false),
  });

  const handleSendSingle = () => {
    if (!selectedFarmerId) return;
    setSendingSingle(true);
    sendMutation.mutate({ farmerId: selectedFarmerId });
  };

  const handleSendAll = () => {
    if (!window.confirm("Send daily briefing to ALL active farmers?")) return;
    setSendingAll(true);
    sendAllMutation.mutate();
  };

  // Parse WhatsApp-style message into sections for visual rendering
  const parseMessage = (msg: string) => {
    const lines = msg.split("\n");
    const sections: { type: string; content: string[] }[] = [];
    let current: { type: string; content: string[] } = { type: "header", content: [] };

    for (const line of lines) {
      if (line.includes("🌦️") && line.includes("WEATHER")) {
        sections.push(current);
        current = { type: "weather", content: [] };
      } else if (line.includes("💰") && line.includes("MARKET")) {
        sections.push(current);
        current = { type: "market", content: [] };
      } else if (line.includes("📋") && line.includes("SCHEME")) {
        sections.push(current);
        current = { type: "schemes", content: [] };
      } else if (line.includes("💡") && line.includes("TIP")) {
        sections.push(current);
        current = { type: "tip", content: [] };
      } else if (line.includes("🤝") && line.includes("Need help")) {
        sections.push(current);
        current = { type: "footer", content: [] };
      }
      current.content.push(line);
    }
    sections.push(current);
    return sections;
  };

  const sectionColors: Record<string, string> = {
    header: "bg-green-50 border-green-200",
    weather: "bg-sky-50 border-sky-200",
    market: "bg-amber-50 border-amber-200",
    schemes: "bg-purple-50 border-purple-200",
    tip: "bg-emerald-50 border-emerald-200",
    footer: "bg-gray-50 border-gray-200",
  };

  const sectionIcons: Record<string, React.ElementType> = {
    header: Sun,
    weather: Sun,
    market: TrendingUp,
    schemes: Landmark,
    tip: Sprout,
    footer: Smartphone,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Briefings</h1>
          <p className="text-muted-foreground mt-1">
            Automated morning briefings for farmers via WhatsApp
          </p>
        </div>
        <Button
          onClick={handleSendAll}
          disabled={sendingAll}
          className="bg-green-600 hover:bg-green-700"
          size="lg"
        >
          {sendingAll ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Radio className="h-4 w-4 mr-2" />
          )}
          Broadcast to All
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Sent</p>
                <p className="text-2xl font-bold">{stats?.total ?? 0}</p>
              </div>
              <div className="h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Newspaper className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Sent Today</p>
                <p className="text-2xl font-bold">{stats?.today ?? 0}</p>
              </div>
              <div className="h-10 w-10 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Farmers</p>
                <p className="text-2xl font-bold">
                  {farmersList?.items.length ?? 0}
                </p>
              </div>
              <div className="h-10 w-10 bg-amber-100 rounded-lg flex items-center justify-center">
                <Users className="h-5 w-5 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold">
                  {stats?.byStatus.find((s) => s.status === "pending")?.count ?? 0}
                </p>
              </div>
              <div className="h-10 w-10 bg-orange-100 rounded-lg flex items-center justify-center">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={previewTab} onValueChange={setPreviewTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="preview">Preview & Send</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* PREVIEW TAB */}
        <TabsContent value="preview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Farmer Selection */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Select Farmer
                  </h3>
                  <Select
                    value={selectedFarmerId?.toString() ?? ""}
                    onValueChange={(v) =>
                      setSelectedFarmerId(parseInt(v))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a farmer to preview" />
                    </SelectTrigger>
                    <SelectContent>
                      {farmersList?.items.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>
                          {f.name ?? f.phoneNumber} ({f.preferredLanguage})
                          {f.primaryCrop ? ` - ${f.primaryCrop}` : ""}
                          {f.district ? `, ${f.district}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Farmer Profile Summary */}
                  {selectedFarmerId && preview?.farmer && (
                    <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-2">
                      <h4 className="text-sm font-medium">Farmer Profile</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Name:</span>{" "}
                          {preview.farmer.name ?? "-"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Language:</span>{" "}
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {preview.farmer.language}
                          </Badge>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Location:</span>{" "}
                          {preview.farmer.location ?? "-"}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Crop:</span>{" "}
                          {preview.farmer.crop ? (
                            <Badge className="text-[10px] bg-green-100 text-green-800">
                              {preview.farmer.crop}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">Not set</span>
                          )}
                        </div>
                      </div>

                      {/* Personalization Status */}
                      <div className="pt-2 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">Personalized</span>
                          <Switch checked={preview.personalizationUsed} />
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {preview.personalizationUsed
                            ? "Content tailored to farmer's crop & location"
                            : "Add crop & location to farmer profile for personalization"}
                        </p>
                      </div>

                      {/* Content Sections */}
                      <div className="pt-2 border-t space-y-1">
                        <p className="text-xs font-medium">Included Sections</p>
                        <div className="flex flex-wrap gap-1">
                          {preview.sections.weather && (
                            <Badge className="text-[10px] bg-sky-100 text-sky-800">
                              Weather
                            </Badge>
                          )}
                          {preview.sections.marketPrices > 0 && (
                            <Badge className="text-[10px] bg-amber-100 text-amber-800">
                              {preview.sections.marketPrices} Prices
                            </Badge>
                          )}
                          {preview.sections.schemes > 0 && (
                            <Badge className="text-[10px] bg-purple-100 text-purple-800">
                              {preview.sections.schemes} Schemes
                            </Badge>
                          )}
                          {preview.sections.cropTip && (
                            <Badge className="text-[10px] bg-emerald-100 text-emerald-800">
                              Crop Tip
                            </Badge>
                          )}
                        </div>
                      </div>

                      <Button
                        onClick={handleSendSingle}
                        disabled={sendingSingle || sendMutation.isPending}
                        className="w-full mt-3"
                      >
                        {sendMutation.isPending || sendingSingle ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        Send to This Farmer
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Personalization Guide */}
              <Card>
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <Sprout className="h-4 w-4" />
                    How Personalization Works
                  </h3>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      When a farmer sets their <strong>crop</strong>, <strong>location</strong>, and{" "}
                      <strong>language</strong> in their profile:
                    </p>
                    <ul className="space-y-1 list-disc list-inside">
                      <li>Weather shows their local area</li>
                      <li>Market prices show their crop rates</li>
                      <li>Government schemes filtered by their state</li>
                      <li>Farming tips specific to their crop</li>
                      <li>Entire message in their language</li>
                    </ul>
                    <p className="text-xs pt-1">
                      Farmers without profiles still receive briefings with general data.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Preview Card */}
            <div className="lg:col-span-3">
              <Card className="h-full">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    WhatsApp Preview
                  </h3>

                  {!selectedFarmerId ? (
                    <div className="h-[500px] flex items-center justify-center text-muted-foreground text-sm">
                      Select a farmer to preview their personalized briefing
                    </div>
                  ) : previewLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-8 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : preview?.error ? (
                    <div className="h-[500px] flex items-center justify-center text-red-500">
                      <AlertCircle className="h-5 w-5 mr-2" />
                      {preview.error}
                    </div>
                  ) : (
                    <div className="bg-[#e5ddd5] rounded-lg p-3 max-h-[550px] overflow-y-auto">
                      {/* WhatsApp Bubble */}
                      <div className="bg-white rounded-lg shadow-sm p-4 max-w-[95%]">
                        {preview?.message
                          ? parseMessage(preview.message).map((section, i) => {
                              const Icon = sectionIcons[section.type] ?? Smartphone;
                              return (
                                <div key={i}>
                                  {section.type !== "header" && (
                                    <div className={`my-2 p-2 rounded-md border ${sectionColors[section.type] ?? "bg-gray-50"}`}>
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <Icon className="h-3.5 w-3.5" />
                                        <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                                          {section.type}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {section.content.map((line, j) => (
                                    <p
                                      key={j}
                                      className="text-sm whitespace-pre-wrap leading-relaxed"
                                      dangerouslySetInnerHTML={{
                                        __html: line
                                          .replace(/\*(.*?)\*/g, "<strong>$1</strong>")
                                          .replace(/─+/g, "<span class='text-gray-300'>${'─'.repeat(20)}</span>"),
                                      }}
                                    />
                                  ))}
                                </div>
                              );
                            })
                          : null}
                      </div>
                      <p className="text-[10px] text-gray-500 text-center mt-2">
                        This is how the message appears in WhatsApp
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* HISTORY TAB */}
        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            <CardContent className="p-0">
              {!history ? (
                <div className="p-6 space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium">Farmer</th>
                        <th className="text-left px-4 py-3 font-medium">Language</th>
                        <th className="text-left px-4 py-3 font-medium">Status</th>
                        <th className="text-left px-4 py-3 font-medium">Personalized</th>
                        <th className="text-left px-4 py-3 font-medium">Sent At</th>
                        <th className="text-left px-4 py-3 font-medium">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.items.map((item) => (
                        <tr
                          key={item.id}
                          className="border-b hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">
                              {item.farmerName ?? item.farmerPhone ?? "Unknown"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="capitalize text-xs">
                              {item.language}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              className={
                                item.status === "sent"
                                  ? "bg-green-100 text-green-800"
                                  : item.status === "failed"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-800"
                              }
                            >
                              {item.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Switch
                              checked={item.personalizationUsed ?? false}
                              disabled
                              className="scale-75"
                            />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {item.sentAt
                              ? new Date(item.sentAt).toLocaleString("en-IN")
                              : "-"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="max-w-[300px] truncate text-xs text-muted-foreground">
                              {item.generatedMessage?.split("\n")[0] ?? "-"}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {history.items.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="text-center py-12 text-muted-foreground"
                          >
                            No briefings sent yet. Preview and send your first one!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {history && history.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                Page {page} of {history.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPage((p) => Math.min(history.totalPages, p + 1))
                }
                disabled={page === history.totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
