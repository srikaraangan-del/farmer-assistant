import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Newspaper, Send, Users, CheckCircle, Loader2, Eye, ChevronLeft, ChevronRight, Clock, TrendingUp, Radio, Wifi, CloudSun, BrainCircuit, Sparkles, Rss, RefreshCw, ExternalLink, Trash2 } from "lucide-react";

export default function DailyBriefings() {
  const [selectedFarmerId, setSelectedFarmerId] = useState<number | null>(null);
  const [previewTab, setPreviewTab] = useState("preview");
  const [page, setPage] = useState(1);

  const utils = trpc.useUtils();
  const { data: stats } = trpc.briefings.stats.useQuery();
  const { data: newsStats } = trpc.news.stats.useQuery();
  const { data: newsList, isLoading: newsLoading } = trpc.news.list.useQuery();
  const refreshNewsMutation = trpc.news.refresh.useMutation({
    onSuccess: (data) => {
      toast.success(`News refreshed!`, { description: `${data.inserted} new, ${data.duplicates} duplicates` });
      utils.news.list.invalidate();
      utils.news.stats.invalidate();
    },
    onError: (err) => {
      toast.error("Refresh failed", { description: err.message });
    },
  });
  const deleteNewsMutation = trpc.news.delete.useMutation({
    onSuccess: () => {
      toast.success("News item removed");
      utils.news.list.invalidate();
      utils.news.stats.invalidate();
    },
  });
  const { data: history } = trpc.briefings.list.useQuery({ page, limit: 20 });
  const { data: farmersList } = trpc.farmers.list.useQuery({ isActive: true, limit: 100 });
  const { data: dataSources } = trpc.briefings.dataSources.useQuery();
  const { data: preview, isLoading: previewLoading } = trpc.briefings.generate.useQuery(
    { farmerId: selectedFarmerId! }, { enabled: !!selectedFarmerId }
  );
  const sendMutation = trpc.briefings.send.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        toast.error("Send failed", { description: String(data.error) });
      } else if (data.status === "sent") {
        toast.success("Briefing sent!", { description: `Message delivered to ${data.farmer?.name ?? data.farmer?.phoneNumber ?? "farmer"}` });
      } else {
        toast.error("WhatsApp delivery failed", { description: "Check server logs or WhatsApp token" });
      }
      utils.briefings.list.invalidate();
      utils.briefings.stats.invalidate();
    },
    onError: (err) => {
      toast.error("Send failed", { description: err.message });
    },
  });
  const sendAllMutation = trpc.briefings.sendToAll.useMutation({
    onSuccess: (data) => {
      toast.success(`Broadcast complete!`, { description: `${data.sent} sent, ${data.failed} failed` });
      utils.briefings.list.invalidate();
      utils.briefings.stats.invalidate();
    },
    onError: (err) => {
      toast.error("Broadcast failed", { description: err.message });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Briefings</h1>
          <p className="text-muted-foreground mt-1">AI pulls LIVE weather, market prices, and schemes automatically</p>
        </div>
        <Button onClick={() => { if (window.confirm("Send daily briefing to ALL active farmers?")) sendAllMutation.mutate(); }} disabled={sendAllMutation.isPending} className="bg-green-600 hover:bg-green-700" size="lg">
          {sendAllMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Radio className="h-4 w-4 mr-2" />}
          Broadcast to All
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        <Card><CardContent className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Total Sent</p><p className="text-2xl font-bold">{stats?.total ?? 0}</p></div><div className="h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center"><Newspaper className="h-5 w-5 text-blue-600" /></div></div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Sent Today</p><p className="text-2xl font-bold">{stats?.today ?? 0}</p></div><div className="h-10 w-10 bg-green-100 rounded-lg flex items-center justify-center"><CheckCircle className="h-5 w-5 text-green-600" /></div></div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Active Farmers</p><p className="text-2xl font-bold">{farmersList?.items.length ?? 0}</p></div><div className="h-10 w-10 bg-amber-100 rounded-lg flex items-center justify-center"><Users className="h-5 w-5 text-amber-600" /></div></div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Pending</p><p className="text-2xl font-bold">{stats?.byStatus?.find((s: any) => s.status === "pending")?.count ?? 0}</p></div><div className="h-10 w-10 bg-orange-100 rounded-lg flex items-center justify-center"><Clock className="h-5 w-5 text-orange-600" /></div></div></CardContent></Card>
        <Card><CardContent className="p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">News Articles</p><p className="text-2xl font-bold">{newsStats?.total ?? 0}</p></div><div className="h-10 w-10 bg-red-100 rounded-lg flex items-center justify-center"><Rss className="h-5 w-5 text-red-600" /></div></div></CardContent></Card>
      </div>

      <Card className="border-primary/20">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">AI Data Sources — All Automated</h3>
            <Badge variant="default" className="text-[10px]">NO MANUAL DATA ENTRY</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg border bg-sky-50 border-sky-200">
              <div className="flex items-center gap-2 mb-2"><Wifi className="h-4 w-4 text-green-600" /><CloudSun className="h-5 w-5 text-sky-600" /><span className="font-medium text-sm">Weather</span><Badge variant="default" className="text-[10px] ml-auto">LIVE</Badge></div>
              <p className="text-xs text-muted-foreground">{dataSources?.weather.source ?? "Open-Meteo API"}</p>
            </div>
            <div className="p-4 rounded-lg border bg-amber-50 border-amber-200">
              <div className="flex items-center gap-2 mb-2"><Wifi className="h-4 w-4 text-green-600" /><TrendingUp className="h-5 w-5 text-amber-600" /><span className="font-medium text-sm">Market Prices</span><Badge variant="default" className="text-[10px] ml-auto">LIVE</Badge></div>
              <p className="text-xs text-muted-foreground">{dataSources?.marketPrices.source ?? "Agmarknet API"}</p>
            </div>
            <div className="p-4 rounded-lg border bg-purple-50 border-purple-200">
              <div className="flex items-center gap-2 mb-2"><Wifi className="h-4 w-4 text-green-600" /><BrainCircuit className="h-5 w-5 text-purple-600" /><span className="font-medium text-sm">AI Engine</span><Badge variant="default" className="text-[10px] ml-auto">ACTIVE</Badge></div>
              <p className="text-xs text-muted-foreground">Government DB + AI Crop Advice</p>
            </div>
            <div className="p-4 rounded-lg border bg-red-50 border-red-200">
              <div className="flex items-center gap-2 mb-2"><Wifi className="h-4 w-4 text-green-600" /><Rss className="h-5 w-5 text-red-600" /><span className="font-medium text-sm">Daily News</span><Badge variant="default" className="text-[10px] ml-auto">RSS</Badge></div>
              <p className="text-xs text-muted-foreground">The Hindu, Krishak Jagat RSS</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={previewTab} onValueChange={setPreviewTab}>
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="preview">Preview &amp; Send</TabsTrigger>
          <TabsTrigger value="news">Daily News</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="preview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><Users className="h-4 w-4" />Select Farmer</h3>
                  <Select value={selectedFarmerId?.toString() ?? ""} onValueChange={(v) => setSelectedFarmerId(parseInt(v))}>
                    <SelectTrigger><SelectValue placeholder="Choose a farmer to preview" /></SelectTrigger>
                    <SelectContent>
                      {farmersList?.items.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>
                          {f.name ?? f.phoneNumber} ({f.preferredLanguage}){f.primaryCrop ? ` - ${f.primaryCrop}` : ""}{f.district ? `, ${f.district}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedFarmerId && preview?.farmer && (
                    <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-3">
                      <h4 className="text-sm font-medium">Farmer Profile</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-muted-foreground">Name:</span> {preview.farmer.name ?? "-"}</div>
                        <div><span className="text-muted-foreground">Language:</span> <Badge variant="outline" className="text-[10px] capitalize">{preview.farmer.language}</Badge></div>
                        <div><span className="text-muted-foreground">Location:</span> {preview.farmer.location ?? "-"}</div>
                        <div><span className="text-muted-foreground">Crop:</span> {preview.farmer.crop ? <Badge className="text-[10px] bg-green-100 text-green-800">{preview.farmer.crop}</Badge> : <span className="text-muted-foreground">Not set</span>}</div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {preview.sections.weather && <Badge className="text-[10px] bg-sky-100 text-sky-800">Weather</Badge>}
                        {preview.sections.marketPrices > 0 && <Badge className="text-[10px] bg-amber-100 text-amber-800">{preview.sections.marketPrices} Prices</Badge>}
                        {preview.sections.schemes > 0 && <Badge className="text-[10px] bg-purple-100 text-purple-800">{preview.sections.schemes} Schemes</Badge>}
                        {preview.sections.cropTip && <Badge className="text-[10px] bg-emerald-100 text-emerald-800">Crop Tip</Badge>}
                      </div>
                      <Button onClick={() => sendMutation.mutate({ farmerId: selectedFarmerId })} disabled={sendMutation.isPending} className="w-full">
                        {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                        Send to This Farmer
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />How Auto-Pull Works</h3>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>When a farmer sets their <strong>crop</strong>, <strong>location</strong>, and <strong>language</strong>:</p>
                    <ul className="space-y-1 list-disc list-inside text-xs">
                      <li>Weather shows their local area</li>
                      <li>Market prices show their crop rates</li>
                      <li>Government schemes filtered by state</li>
                      <li>Farming tips specific to their crop</li>
                      <li>Entire message in their language</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-3">
              <Card className="h-full">
                <CardContent className="p-5">
                  <h3 className="font-semibold mb-3 flex items-center gap-2"><Eye className="h-4 w-4" />WhatsApp Card Preview</h3>
                  {!selectedFarmerId ? (
                    <div className="h-[500px] flex items-center justify-center text-muted-foreground text-sm">Select a farmer to see their AI-generated briefing</div>
                  ) : previewLoading ? (
                    <div className="space-y-3"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
                  ) : preview?.error ? (
                    <div className="h-[500px] flex items-center justify-center text-red-500">{preview.error}</div>
                  ) : (
                    <div className="bg-[#e5ddd5] rounded-lg p-3 max-h-[550px] overflow-y-auto">
                      <div className="bg-white rounded-lg shadow-sm p-4 max-w-[95%]">
                        <pre className="text-sm whitespace-pre-wrap leading-relaxed font-sans">{preview?.message}</pre>
                      </div>
                      <p className="text-[10px] text-gray-500 text-center mt-2">AI-generated card with live data</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="news" className="space-y-4 mt-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Rss className="h-5 w-5 text-red-600" />
                  <h3 className="font-semibold">Daily Farming News</h3>
                  <Badge variant="secondary" className="text-xs">{newsStats?.total ?? 0} articles</Badge>
                  {newsStats && newsStats.today > 0 && <Badge variant="default" className="text-xs bg-green-100 text-green-800">{newsStats.today} today</Badge>}
                </div>
                <Button onClick={() => refreshNewsMutation.mutate()} disabled={refreshNewsMutation.isPending} size="sm" variant="outline">
                  {refreshNewsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Fetch Latest
                </Button>
              </div>

              {newsLoading ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
              ) : !newsList || newsList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Rss className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No news articles yet.</p>
                  <p className="text-xs mt-1">Click "Fetch Latest" to pull farming news from RSS feeds.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {newsList.map((item) => (
                    <div key={item.id} className="border rounded-lg p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-sm">{item.title}</h4>
                            <Badge variant="outline" className="text-[10px] shrink-0">{item.source}</Badge>
                            <Badge variant="secondary" className="text-[10px] shrink-0 capitalize">{item.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>
                          <div className="flex items-center gap-3 mt-2">
                            {item.sourceUrl && (
                              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                                <ExternalLink className="h-3 w-3" /> Read full article
                              </a>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {item.publishedDate ? new Date(item.publishedDate).toLocaleDateString() : new Date(item.fetchedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { if (window.confirm("Remove this news item?")) deleteNewsMutation.mutate({ id: item.id }); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          <Card>
            <CardContent className="p-0">
              {!history ? (
                <div className="p-6 space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Farmer</th>
                      <th className="text-left px-4 py-3 font-medium">Language</th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium">Personalized</th>
                      <th className="text-left px-4 py-3 font-medium">Sent At</th>
                    </tr></thead>
                    <tbody>
                      {history.items.map((item: any) => (
                        <tr key={item.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-medium">{item.farmerName ?? item.farmerPhone ?? "Unknown"}</td>
                          <td className="px-4 py-3"><Badge variant="outline" className="capitalize text-xs">{item.language}</Badge></td>
                          <td className="px-4 py-3"><Badge className={item.status === "sent" ? "bg-green-100 text-green-800" : item.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>{item.status}</Badge></td>
                          <td className="px-4 py-3"><Switch checked={item.personalizationUsed ?? false} disabled className="scale-75" /></td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{item.sentAt ? new Date(item.sentAt).toLocaleString("en-IN") : "-"}</td>
                        </tr>
                      ))}
                      {history.items.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-muted-foreground">No briefings sent yet. Preview and send your first one!</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          {history && history.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-sm">Page {page} of {history.totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(history.totalPages, p + 1))} disabled={page === history.totalPages}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
