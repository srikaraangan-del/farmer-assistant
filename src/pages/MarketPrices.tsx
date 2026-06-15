import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Plus,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronLeft,
  ChevronRight,
  MapPin,
  IndianRupee,
} from "lucide-react";

export default function MarketPrices() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    commodity: "",
    variety: "",
    mandiName: "",
    district: "",
    state: "",
    pricePerQuintal: "",
    minPrice: "",
    maxPrice: "",
    priceDate: new Date().toISOString().split("T")[0],
    priceTrend: "stable" as "up" | "down" | "stable",
    source: "",
  });

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.marketPrices.list.useQuery({
    commodity: search || undefined,
    page,
    limit: 20,
  });

  const { data: stats } = trpc.marketPrices.getCommodities.useQuery();

  const createMutation = trpc.marketPrices.create.useMutation({
    onSuccess: () => {
      utils.marketPrices.list.invalidate();
      resetForm();
      setDialogOpen(false);
    },
  });

  const updateMutation = trpc.marketPrices.update.useMutation({
    onSuccess: () => {
      utils.marketPrices.list.invalidate();
      resetForm();
      setDialogOpen(false);
      setEditingId(null);
    },
  });

  const resetForm = () => {
    setForm({
      commodity: "",
      variety: "",
      mandiName: "",
      district: "",
      state: "",
      pricePerQuintal: "",
      minPrice: "",
      maxPrice: "",
      priceDate: new Date().toISOString().split("T")[0],
      priceTrend: "stable",
      source: "",
    });
  };

  const handleSubmit = () => {
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        commodity: form.commodity || undefined,
        mandiName: form.mandiName || undefined,
        state: form.state || undefined,
        pricePerQuintal: form.pricePerQuintal ? parseFloat(form.pricePerQuintal) : undefined,
        priceTrend: form.priceTrend,
      });
    } else {
      createMutation.mutate({
        commodity: form.commodity,
        variety: form.variety || undefined,
        mandiName: form.mandiName,
        district: form.district || undefined,
        state: form.state,
        pricePerQuintal: parseFloat(form.pricePerQuintal),
        minPrice: form.minPrice ? parseFloat(form.minPrice) : undefined,
        maxPrice: form.maxPrice ? parseFloat(form.maxPrice) : undefined,
        priceDate: form.priceDate,
        priceTrend: form.priceTrend,
        source: form.source || undefined,
      });
    }
  };

  const TrendIcon = ({ trend }: { trend: string }) => {
    if (trend === "up")
      return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trend === "down")
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Market Prices</h1>
          <p className="text-muted-foreground mt-1">
            Manage mandi prices and commodity rates
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setEditingId(null); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Price
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Price" : "Add Market Price"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Commodity *</Label>
                  <Input
                    value={form.commodity}
                    onChange={(e) => setForm({ ...form, commodity: e.target.value })}
                    placeholder="e.g. Rice"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Variety</Label>
                  <Input
                    value={form.variety}
                    onChange={(e) => setForm({ ...form, variety: e.target.value })}
                    placeholder="e.g. Basmati"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mandi Name *</Label>
                  <Input
                    value={form.mandiName}
                    onChange={(e) => setForm({ ...form, mandiName: e.target.value })}
                    placeholder="e.g. Hyderabad"
                  />
                </div>
                <div className="space-y-2">
                  <Label>State *</Label>
                  <Input
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    placeholder="e.g. Telangana"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>District</Label>
                <Input
                  value={form.district}
                  onChange={(e) => setForm({ ...form, district: e.target.value })}
                  placeholder="e.g. Ranga Reddy"
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Price/Quintal *</Label>
                  <Input
                    type="number"
                    value={form.pricePerQuintal}
                    onChange={(e) =>
                      setForm({ ...form, pricePerQuintal: e.target.value })
                    }
                    placeholder="2150"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Min Price</Label>
                  <Input
                    type="number"
                    value={form.minPrice}
                    onChange={(e) => setForm({ ...form, minPrice: e.target.value })}
                    placeholder="2100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Price</Label>
                  <Input
                    type="number"
                    value={form.maxPrice}
                    onChange={(e) => setForm({ ...form, maxPrice: e.target.value })}
                    placeholder="2200"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={form.priceDate}
                  onChange={(e) => setForm({ ...form, priceDate: e.target.value })}
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={
                  !form.commodity ||
                  !form.mandiName ||
                  !form.state ||
                  !form.pricePerQuintal ||
                  createMutation.isPending
                }
                className="w-full"
              >
                {editingId ? "Update" : "Add"} Price
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search commodity..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Stats */}
      {stats && stats.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {stats.slice(0, 10).map((s) => (
            <Badge key={s.commodity} variant="secondary" className="text-xs">
              {s.commodity}
            </Badge>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium">Commodity</th>
                    <th className="text-left px-4 py-3 font-medium">Mandi</th>
                    <th className="text-left px-4 py-3 font-medium">Location</th>
                    <th className="text-left px-4 py-3 font-medium">Price/Quintal</th>
                    <th className="text-left px-4 py-3 font-medium">Trend</th>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.commodity}</div>
                        {item.variety && (
                          <div className="text-xs text-muted-foreground">
                            {item.variety}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{item.mandiName}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          {item.district ? `${item.district}, ` : ""}
                          {item.state}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-semibold">
                            {item.pricePerQuintal.toLocaleString("en-IN")}
                          </span>
                          {item.minPrice && item.maxPrice && (
                            <span className="text-xs text-muted-foreground">
                              ({item.minPrice}-{item.maxPrice})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <TrendIcon trend={item.priceTrend ?? "stable"} />
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {item.priceTrend ?? "stable"}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {item.priceDate
                          ? new Date(item.priceDate).toLocaleDateString("en-IN")
                          : "-"}
                      </td>
                    </tr>
                  ))}
                  {data?.items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted-foreground">
                        No market prices found. Add your first price entry.
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
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, data.total)} of{" "}
            {data.total}
          </p>
          <div className="flex items-center gap-2">
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
        </div>
      )}
    </div>
  );
}
