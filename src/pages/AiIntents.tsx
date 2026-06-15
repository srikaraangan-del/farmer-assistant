import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Plus,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  BarChart3,
} from "lucide-react";

const handlerColors: Record<string, string> = {
  weather: "bg-sky-100 text-sky-800",
  market_price: "bg-green-100 text-green-800",
  scheme: "bg-purple-100 text-purple-800",
  crop_advice: "bg-amber-100 text-amber-800",
  general: "bg-gray-100 text-gray-800",
  voice: "bg-pink-100 text-pink-800",
  fallback: "bg-red-100 text-red-800",
};

export default function AiIntents() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    intentName: "",
    keywords: "",
    description: "",
    responseTemplate: "",
    handlerType: "general" as string,
    confidence: "0.8",
  });

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.aiIntents.list.useQuery({
    search: search || undefined,
    page,
    limit: 20,
  });

  const createMutation = trpc.aiIntents.create.useMutation({
    onSuccess: () => {
      utils.aiIntents.list.invalidate();
      setDialogOpen(false);
    },
  });

  const toggleMutation = trpc.aiIntents.update.useMutation({
    onSuccess: () => utils.aiIntents.list.invalidate(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Intents</h1>
          <p className="text-muted-foreground mt-1">
            Manage AI intent detection patterns and responses
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Intent
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add AI Intent</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Intent Name *</Label>
                <Input
                  value={form.intentName}
                  onChange={(e) =>
                    setForm({ ...form, intentName: e.target.value })
                  }
                  placeholder="e.g. weather_query"
                />
              </div>
              <div className="space-y-2">
                <Label>Keywords</Label>
                <Textarea
                  value={form.keywords}
                  onChange={(e) =>
                    setForm({ ...form, keywords: e.target.value })
                  }
                  placeholder="Comma-separated keywords: weather, rain, temperature"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="What this intent detects"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Response Template</Label>
                <Textarea
                  value={form.responseTemplate}
                  onChange={(e) =>
                    setForm({ ...form, responseTemplate: e.target.value })
                  }
                  placeholder="Default response for this intent"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Handler Type</Label>
                <Select
                  value={form.handlerType}
                  onValueChange={(v) => setForm({ ...form, handlerType: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weather">Weather</SelectItem>
                    <SelectItem value="market_price">Market Price</SelectItem>
                    <SelectItem value="scheme">Scheme</SelectItem>
                    <SelectItem value="crop_advice">Crop Advice</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="voice">Voice</SelectItem>
                    <SelectItem value="fallback">Fallback</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    intentName: form.intentName,
                    keywords: form.keywords || undefined,
                    description: form.description || undefined,
                    responseTemplate: form.responseTemplate || undefined,
                    handlerType: form.handlerType as any,
                    confidence: parseFloat(form.confidence),
                  })
                }
                disabled={!form.intentName || createMutation.isPending}
                className="w-full"
              >
                Add Intent
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search intents..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
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
                    <th className="text-left px-4 py-3 font-medium">Intent</th>
                    <th className="text-left px-4 py-3 font-medium">Handler</th>
                    <th className="text-left px-4 py-3 font-medium">Keywords</th>
                    <th className="text-left px-4 py-3 font-medium">Usage</th>
                    <th className="text-left px-4 py-3 font-medium">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((intent) => (
                    <tr
                      key={intent.id}
                      className="border-b hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{intent.intentName}</div>
                            {intent.description && (
                              <div className="text-xs text-muted-foreground max-w-[200px] truncate">
                                {intent.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={`text-[10px] capitalize ${
                            handlerColors[intent.handlerType] ?? ""
                          }`}
                        >
                          {intent.handlerType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground max-w-[200px] truncate block">
                          {intent.keywords}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{intent.usageCount}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={intent.isActive}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({
                              id: intent.id,
                              isActive: checked,
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                  {data?.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="text-center py-12 text-muted-foreground"
                      >
                        No intents found. Add your first intent.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.totalPages > 1 && (
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
            Page {page} of {data.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page === data.totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
