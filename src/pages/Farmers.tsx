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
  Upload,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { Link } from "react-router";
import * as XLSX from "xlsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Language = "telugu" | "hindi" | "kannada" | "english";

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

  const importMutation = trpc.farmers.importBulk.useMutation({
    onSuccess: (result) => {
      utils.farmers.list.invalidate();
      utils.farmers.stats.invalidate();
      alert(`Import complete! Inserted: ${result.inserted}, Skipped (duplicates): ${result.skipped}`);
    },
    onError: (err) => {
      alert("Import failed: " + err.message);
    },
  });

  const { data: allFarmersData } = trpc.farmers.exportAll.useQuery(undefined, {
    enabled: false,
  });

  const utilsExport = trpc.useUtils();

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

  // Export farmers to Excel
  const handleExport = async () => {
    const data = await utilsExport.farmers.exportAll.fetch();
    if (!data || data.length === 0) {
      alert("No farmers to export");
      return;
    }

    const exportData = data.map((f) => ({
      "Phone Number": f.phoneNumber,
      "Name": f.name ?? "",
      "Preferred Language": f.preferredLanguage,
      "Location": f.location ?? "",
      "District": f.district ?? "",
      "State": f.state ?? "",
      "Land Size (acres)": f.landSize ?? "",
      "Primary Crop": f.primaryCrop ?? "",
      "Secondary Crops": f.secondaryCrops ?? "",
      "Active": f.isActive ? "Yes" : "No",
      "Total Interactions": f.totalInteractions ?? 0,
      "Created At": f.createdAt ? new Date(f.createdAt).toLocaleDateString() : "",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Farmers");
    XLSX.writeFile(wb, `farmers_export_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Download template Excel
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        "phoneNumber": "919876543210",
        "name": "Ramesh Kumar",
        "preferredLanguage": "hindi",
        "location": "Village Badarpur",
        "district": "Gurgaon",
        "state": "Haryana",
        "landSize": 5,
        "primaryCrop": "Wheat",
        "secondaryCrops": "Mustard,Barley",
      },
      {
        "phoneNumber": "919876543211",
        "name": "Lakshmi Devi",
        "preferredLanguage": "telugu",
        "location": "Ramapuram",
        "district": "Guntur",
        "state": "Andhra Pradesh",
        "landSize": 3.5,
        "primaryCrop": "Rice",
        "secondaryCrops": "Cotton",
      },
      {
        "phoneNumber": "919876543212",
        "name": "Rajanna Gowda",
        "preferredLanguage": "kannada",
        "location": "Hassan",
        "district": "Hassan",
        "state": "Karnataka",
        "landSize": 10,
        "primaryCrop": "Coffee",
        "secondaryCrops": "Pepper,Cardamom",
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();

    // Add instructions sheet
    const instructions = [
      { "Field": "phoneNumber", "Required": "Yes", "Format": "With country code (e.g., 919876543210)", "Example": "919876543210" },
      { "Field": "name", "Required": "No", "Format": "Farmer full name", "Example": "Ramesh Kumar" },
      { "Field": "preferredLanguage", "Required": "No", "Format": "english, hindi, telugu, or kannada", "Example": "hindi" },
      { "Field": "location", "Required": "No", "Format": "Village or area name", "Example": "Village Badarpur" },
      { "Field": "district", "Required": "No", "Format": "District name", "Example": "Gurgaon" },
      { "Field": "state", "Required": "No", "Format": "State name", "Example": "Haryana" },
      { "Field": "landSize", "Required": "No", "Format": "Number in acres", "Example": "5" },
      { "Field": "primaryCrop", "Required": "No", "Format": "Main crop name", "Example": "Wheat" },
      { "Field": "secondaryCrops", "Required": "No", "Format": "Comma separated", "Example": "Mustard,Barley" },
    ];
    const wsInstructions = XLSX.utils.json_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstructions, "Instructions");
    XLSX.utils.book_append_sheet(wb, ws, "Data Template");

    XLSX.writeFile(wb, `farmer_import_template.xlsx`);
  };

  // Import farmers from Excel
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("data") || n.toLowerCase().includes("template")) || workbook.SheetNames[workbook.SheetNames.length - 1];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;

        const farmers = jsonData.map((row) => ({
          phoneNumber: String(row.phoneNumber || row["Phone Number"] || row["phone"] || "").trim(),
          name: String(row.name || row["Name"] || "").trim() || undefined,
          preferredLanguage: String(row.preferredLanguage || row["Preferred Language"] || row["preferred_language"] || "english").trim().toLowerCase() as Language,
          location: String(row.location || row["Location"] || "").trim() || undefined,
          district: String(row.district || row["District"] || "").trim() || undefined,
          state: String(row.state || row["State"] || "").trim() || undefined,
          landSize: row.landSize || row["Land Size (acres)"] || row["landSize"] ? Number(row.landSize || row["Land Size (acres)"] || row["landSize"]) : undefined,
          primaryCrop: String(row.primaryCrop || row["Primary Crop"] || row["primaryCrop"] || "").trim() || undefined,
          secondaryCrops: String(row.secondaryCrops || row["Secondary Crops"] || row["secondaryCrops"] || "").trim() || undefined,
        })).filter((f) => f.phoneNumber && f.phoneNumber.length >= 10);

        if (farmers.length === 0) {
          alert("No valid farmers found in the file. Please check the template format.");
          return;
        }

        if (confirm(`Found ${farmers.length} farmer(s) to import. Proceed?`)) {
          importMutation.mutate(farmers);
        }
      } catch (err: any) {
        alert("Error reading file: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ""; // Reset input
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
        <div className="flex gap-2">
          {/* Import */}
          <input
            type="file"
            id="import-farmers"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleImport}
          />
          <label htmlFor="import-farmers" className="cursor-pointer inline-flex">
            <Button variant="outline" className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
          </label>

          {/* Export Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export All Farmers (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadTemplate}>
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Download Template (.xlsx)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
                    <SelectItem value="kannada">Kannada</SelectItem>
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
            <SelectItem value="kannada">Kannada</SelectItem>
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
