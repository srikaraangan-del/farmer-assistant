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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Plus,
  Landmark,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

const categoryColors: Record<string, string> = {
  loan: "bg-blue-100 text-blue-800",
  subsidy: "bg-green-100 text-green-800",
  insurance: "bg-purple-100 text-purple-800",
  grant: "bg-amber-100 text-amber-800",
  training: "bg-pink-100 text-pink-800",
  equipment: "bg-teal-100 text-teal-800",
  other: "bg-gray-100 text-gray-800",
};

export default function Schemes() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    title: "",
    titleTelugu: "",
    titleHindi: "",
    description: "",
    category: "other" as
      | "loan"
      | "subsidy"
      | "insurance"
      | "grant"
      | "training"
      | "equipment"
      | "other",
    eligibility: "",
    benefits: "",
    documentsRequired: "",
    stateSpecific: "",
    department: "",
    officialUrl: "",
  });

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.schemes.list.useQuery({
    search: search || undefined,
    category: categoryFilter === "all" ? undefined : (categoryFilter as any),
    page,
    limit: 20,
  });

  const { data: stats } = trpc.schemes.stats.useQuery();

  const createMutation = trpc.schemes.create.useMutation({
    onSuccess: () => {
      utils.schemes.list.invalidate();
      utils.schemes.stats.invalidate();
      resetForm();
      setDialogOpen(false);
    },
  });

  const resetForm = () => {
    setForm({
      title: "",
      titleTelugu: "",
      titleHindi: "",
      description: "",
      category: "other",
      eligibility: "",
      benefits: "",
      documentsRequired: "",
      stateSpecific: "",
      department: "",
      officialUrl: "",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Government Schemes</h1>
          <p className="text-muted-foreground mt-1">
            Manage government schemes and subsidies ({stats?.active ?? 0} active)
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={resetForm}>
              <Plus className="h-4 w-4 mr-2" />
              Add Scheme
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Government Scheme</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Title (English) *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. PM-KISAN Scheme"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Title (Telugu)</Label>
                  <Input
                    value={form.titleTelugu}
                    onChange={(e) =>
                      setForm({ ...form, titleTelugu: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Title (Hindi)</Label>
                  <Input
                    value={form.titleHindi}
                    onChange={(e) =>
                      setForm({ ...form, titleHindi: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) =>
                    setForm({ ...form, category: v as typeof form.category })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loan">Loan</SelectItem>
                    <SelectItem value="subsidy">Subsidy</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                    <SelectItem value="grant">Grant</SelectItem>
                    <SelectItem value="training">Training</SelectItem>
                    <SelectItem value="equipment">Equipment</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  placeholder="Detailed description of the scheme"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Eligibility</Label>
                  <Textarea
                    value={form.eligibility}
                    onChange={(e) =>
                      setForm({ ...form, eligibility: e.target.value })
                    }
                    placeholder="Who can apply"
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Benefits</Label>
                  <Textarea
                    value={form.benefits}
                    onChange={(e) =>
                      setForm({ ...form, benefits: e.target.value })
                    }
                    placeholder="What farmers get"
                    rows={2}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Documents Required</Label>
                <Textarea
                  value={form.documentsRequired}
                  onChange={(e) =>
                    setForm({ ...form, documentsRequired: e.target.value })
                  }
                  placeholder="List required documents"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>State</Label>
                  <Input
                    value={form.stateSpecific}
                    onChange={(e) =>
                      setForm({ ...form, stateSpecific: e.target.value })
                    }
                    placeholder="e.g. Telangana"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Input
                    value={form.department}
                    onChange={(e) =>
                      setForm({ ...form, department: e.target.value })
                    }
                    placeholder="e.g. Agriculture Dept"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Official URL</Label>
                <Input
                  value={form.officialUrl}
                  onChange={(e) =>
                    setForm({ ...form, officialUrl: e.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    title: form.title,
                    titleTelugu: form.titleTelugu || undefined,
                    titleHindi: form.titleHindi || undefined,
                    description: form.description || undefined,
                    category: form.category,
                    eligibility: form.eligibility || undefined,
                    benefits: form.benefits || undefined,
                    documentsRequired: form.documentsRequired || undefined,
                    stateSpecific: form.stateSpecific || undefined,
                    department: form.department || undefined,
                    officialUrl: form.officialUrl || undefined,
                  })
                }
                disabled={!form.title || createMutation.isPending}
                className="w-full"
              >
                Add Scheme
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search schemes..."
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
            <SelectItem value="loan">Loan</SelectItem>
            <SelectItem value="subsidy">Subsidy</SelectItem>
            <SelectItem value="insurance">Insurance</SelectItem>
            <SelectItem value="grant">Grant</SelectItem>
            <SelectItem value="training">Training</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {stats?.byCategory && (
        <div className="flex flex-wrap gap-2">
          {stats.byCategory.map((c) => (
            <Badge key={c.category} variant="secondary" className="text-xs capitalize">
              {c.category}: {c.count}
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
          data?.items.map((scheme) => (
            <Card key={scheme.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">
                      {scheme.title}
                    </h3>
                    {scheme.titleTelugu && (
                      <p className="text-xs text-muted-foreground">
                        {scheme.titleTelugu}
                      </p>
                    )}
                  </div>
                  <Badge
                    className={`text-[10px] capitalize ${
                      categoryColors[scheme.category] ?? ""
                    }`}
                  >
                    {scheme.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                  {scheme.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {scheme.stateSpecific && (
                    <span className="flex items-center gap-1">
                      <Landmark className="h-3 w-3" />
                      {scheme.stateSpecific}
                    </span>
                  )}
                  {scheme.department && (
                    <span>{scheme.department}</span>
                  )}
                  {scheme.officialUrl && (
                    <a
                      href={scheme.officialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Link
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {data?.items.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No schemes found. Add your first scheme.
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
    </div>
  );
}
