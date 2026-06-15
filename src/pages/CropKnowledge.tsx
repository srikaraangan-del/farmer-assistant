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
import {
  Search,
  Plus,
  Sprout,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";

const categoryColors: Record<string, string> = {
  planting: "bg-green-100 text-green-800",
  fertilizer: "bg-amber-100 text-amber-800",
  irrigation: "bg-blue-100 text-blue-800",
  pest_control: "bg-red-100 text-red-800",
  harvesting: "bg-orange-100 text-orange-800",
  storage: "bg-purple-100 text-purple-800",
  disease: "bg-rose-100 text-rose-800",
  seasonal: "bg-teal-100 text-teal-800",
  general: "bg-gray-100 text-gray-800",
};

export default function CropKnowledge() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const [form, setForm] = useState({
    cropName: "",
    title: "",
    content: "",
    category: "general" as string,
    stage: "",
    season: "",
    region: "",
    tags: "",
  });

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.cropKnowledge.list.useQuery({
    search: search || undefined,
    category: categoryFilter === "all" ? undefined : (categoryFilter as any),
    page,
    limit: 20,
  });

  const { data: stats } = trpc.cropKnowledge.stats.useQuery();

  const createMutation = trpc.cropKnowledge.create.useMutation({
    onSuccess: () => {
      utils.cropKnowledge.list.invalidate();
      utils.cropKnowledge.stats.invalidate();
      setDialogOpen(false);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Crop Knowledge</h1>
          <p className="text-muted-foreground mt-1">
            Farming advice and best practices ({stats?.total ?? 0} articles)
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Article
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Crop Knowledge Article</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Crop Name *</Label>
                <Input
                  value={form.cropName}
                  onChange={(e) => setForm({ ...form, cropName: e.target.value })}
                  placeholder="e.g. Rice, Wheat, Cotton"
                />
              </div>
              <div className="space-y-2">
                <Label>Title *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Best planting practices for paddy"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planting">Planting</SelectItem>
                    <SelectItem value="fertilizer">Fertilizer</SelectItem>
                    <SelectItem value="irrigation">Irrigation</SelectItem>
                    <SelectItem value="pest_control">Pest Control</SelectItem>
                    <SelectItem value="harvesting">Harvesting</SelectItem>
                    <SelectItem value="storage">Storage</SelectItem>
                    <SelectItem value="disease">Disease</SelectItem>
                    <SelectItem value="seasonal">Seasonal</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Content *</Label>
                <Textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Detailed advice..."
                  rows={5}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Input
                    value={form.stage}
                    onChange={(e) => setForm({ ...form, stage: e.target.value })}
                    placeholder="e.g. Seedling"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Season</Label>
                  <Input
                    value={form.season}
                    onChange={(e) => setForm({ ...form, season: e.target.value })}
                    placeholder="e.g. Kharif"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tags (comma separated)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="e.g. organic, low-cost, monsoon"
                />
              </div>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    cropName: form.cropName,
                    title: form.title,
                    content: form.content,
                    category: form.category as any,
                    stage: form.stage || undefined,
                    season: form.season || undefined,
                    tags: form.tags || undefined,
                  })
                }
                disabled={!form.cropName || !form.title || !form.content || createMutation.isPending}
                className="w-full"
              >
                Add Article
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search crop knowledge..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="planting">Planting</SelectItem>
            <SelectItem value="fertilizer">Fertilizer</SelectItem>
            <SelectItem value="irrigation">Irrigation</SelectItem>
            <SelectItem value="pest_control">Pest Control</SelectItem>
            <SelectItem value="harvesting">Harvesting</SelectItem>
            <SelectItem value="storage">Storage</SelectItem>
            <SelectItem value="disease">Disease</SelectItem>
            <SelectItem value="seasonal">Seasonal</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {stats?.topCrops && stats.topCrops.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.topCrops.slice(0, 8).map((c) => (
            <Badge key={c.cropName} variant="secondary" className="text-xs">
              {c.cropName}: {c.count}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2 mb-2" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))
        ) : (
          data?.items.map((item) => (
            <Card key={item.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Sprout className="h-4 w-4 text-green-600" />
                      <h3 className="font-semibold text-sm">{item.title}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Crop: {item.cropName}
                      {item.cropNameTelugu && ` (${item.cropNameTelugu})`}
                    </p>
                  </div>
                  <Badge
                    className={`text-[10px] capitalize ${
                      categoryColors[item.category] ?? ""
                    }`}
                  >
                    {item.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                  {item.content}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {item.stage && (
                      <Badge variant="outline" className="text-[10px]">
                        {item.stage}
                      </Badge>
                    )}
                    {item.season && (
                      <Badge variant="outline" className="text-[10px]">
                        {item.season}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedItem(item);
                      setViewDialogOpen(true);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {data?.items.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No articles found. Add your first knowledge article.
          </div>
        )}
      </div>

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

      {/* View Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedItem?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap gap-2">
              <Badge className={categoryColors[selectedItem?.category] ?? ""}>
                {selectedItem?.category}
              </Badge>
              {selectedItem?.cropName && (
                <Badge variant="outline">{selectedItem.cropName}</Badge>
              )}
              {selectedItem?.stage && (
                <Badge variant="outline">{selectedItem.stage}</Badge>
              )}
              {selectedItem?.season && (
                <Badge variant="outline">{selectedItem.season}</Badge>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap">
              {selectedItem?.content}
            </p>
            {selectedItem?.contentTelugu && (
              <div>
                <h4 className="text-sm font-medium mb-1">Telugu</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedItem.contentTelugu}
                </p>
              </div>
            )}
            {selectedItem?.contentHindi && (
              <div>
                <h4 className="text-sm font-medium mb-1">Hindi</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedItem.contentHindi}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
