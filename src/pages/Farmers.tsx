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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Plus,
  Phone,
  MapPin,
  Languages,
  Crop,
  ChevronLeft,
  ChevronRight,
  Edit,
  Eye,
} from "lucide-react";
import { Link } from "react-router";

type Language = "telugu" | "hindi" | "english";

export default function Farmers() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [languageFilter, setLanguageFilter] = useState<Language | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    phoneNumber: "",
    name: "",
    preferredLanguage: "english" as Language,
    location: "",
    district: "",
    state: "",
    landSize: "",
    primaryCrop: "",
  });

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.farmers.list.useQuery({
    search: search || undefined,
    language: languageFilter,
    page,
    limit: 20,
  });

  const createMutation = trpc.farmers.create.useMutation({
    onSuccess: () => {
      utils.farmers.list.invalidate();
      utils.analytics.dashboard.invalidate();
      resetForm();
      setDialogOpen(false);
    },
  });

  const updateMutation = trpc.farmers.update.useMutation({
    onSuccess: () => {
      utils.farmers.list.invalidate();
      resetForm();
      setDialogOpen(false);
      setEditingId(null);
    },
  });

  const toggleMutation = trpc.farmers.toggleActive.useMutation({
    onSuccess: () => utils.farmers.list.invalidate(),
  });

  const resetForm = () => {
    setForm({
      phoneNumber: "",
      name: "",
      preferredLanguage: "english",
      location: "",
      district: "",
      state: "",
      landSize: "",
      primaryCrop: "",
    });
  };

  const handleSubmit = () => {
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        name: form.name || undefined,
        preferredLanguage: form.preferredLanguage,
        location: form.location || undefined,
        district: form.district || undefined,
        state: form.state || undefined,
        landSize: form.landSize ? parseFloat(form.landSize) : undefined,
        primaryCrop: form.primaryCrop || undefined,
      });
    } else {
      createMutation.mutate({
        phoneNumber: form.phoneNumber,
        name: form.name || undefined,
        preferredLanguage: form.preferredLanguage,
        location: form.location || undefined,
        district: form.district || undefined,
        state: form.state || undefined,
        landSize: form.landSize ? parseFloat(form.landSize) : undefined,
        primaryCrop: form.primaryCrop || undefined,
      });
    }
  };

  const openEdit = (farmer: NonNullable<typeof data>["items"][0]) => {
    setEditingId(farmer.id);
    setForm({
      phoneNumber: farmer.phoneNumber,
      name: farmer.name ?? "",
      preferredLanguage: (farmer.preferredLanguage as Language) ?? "english",
      location: farmer.location ?? "",
      district: farmer.district ?? "",
      state: farmer.state ?? "",
      landSize: farmer.landSize?.toString() ?? "",
      primaryCrop: farmer.primaryCrop ?? "",
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Farmers</h1>
          <p className="text-muted-foreground mt-1">
            Manage registered farmers on WhatsApp
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setEditingId(null); }}>
              <Plus className="h-4 w-4 mr-2" />
              Add Farmer
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Farmer" : "Add New Farmer"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Phone Number *</Label>
                <Input
                  placeholder="+91 98765 43210"
                  value={form.phoneNumber}
                  onChange={(e) =>
                    setForm({ ...form, phoneNumber: e.target.value })
                  }
                  disabled={!!editingId}
                />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="Farmer name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Preferred Language</Label>
                <Select
                  value={form.preferredLanguage}
                  onValueChange={(v) =>
                    setForm({ ...form, preferredLanguage: v as Language })
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>District</Label>
                  <Input
                    placeholder="District"
                    value={form.district}
                    onChange={(e) =>
                      setForm({ ...form, district: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Input
                    placeholder="State"
                    value={form.state}
                    onChange={(e) =>
                      setForm({ ...form, state: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Land Size (acres)</Label>
                  <Input
                    type="number"
                    placeholder="e.g. 5"
                    value={form.landSize}
                    onChange={(e) =>
                      setForm({ ...form, landSize: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Primary Crop</Label>
                  <Input
                    placeholder="e.g. Rice"
                    value={form.primaryCrop}
                    onChange={(e) =>
                      setForm({ ...form, primaryCrop: e.target.value })
                    }
                  />
                </div>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={!form.phoneNumber || createMutation.isPending || updateMutation.isPending}
                className="w-full"
              >
                {editingId ? "Update" : "Create"} Farmer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or phone..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select
          value={languageFilter ?? "all"}
          onValueChange={(v) => {
            setLanguageFilter(v === "all" ? undefined : (v as Language));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Languages</SelectItem>
            <SelectItem value="english">English</SelectItem>
            <SelectItem value="hindi">Hindi</SelectItem>
            <SelectItem value="telugu">Telugu</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
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
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Phone</th>
                    <th className="text-left px-4 py-3 font-medium">Location</th>
                    <th className="text-left px-4 py-3 font-medium">Language</th>
                    <th className="text-left px-4 py-3 font-medium">Crop</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((farmer) => (
                    <tr
                      key={farmer.id}
                      className="border-b hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{farmer.name ?? "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {farmer.phoneNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {farmer.district ?? "-"}
                          {farmer.state ? `, ${farmer.state}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                          <Badge variant="outline" className="capitalize text-xs">
                            {farmer.preferredLanguage}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Crop className="h-3.5 w-3.5 text-muted-foreground" />
                          {farmer.primaryCrop ?? "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Switch
                          checked={farmer.isActive}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({
                              id: farmer.id,
                              isActive: checked,
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(farmer)}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Link to={`/conversations?farmerId=${farmer.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data?.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-muted-foreground">
                        No farmers found. Add your first farmer to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, data.total)} of{" "}
            {data.total} farmers
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
