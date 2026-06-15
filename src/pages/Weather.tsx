import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Droplets,
  Wind,
  Thermometer,
  Search,
  Plus,
  MapPin,
  ChevronLeft,
  ChevronRight,
  CloudRain,
} from "lucide-react";

export default function Weather() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    location: "",
    district: "",
    state: "",
    temperature: "",
    humidity: "",
    windSpeed: "",
    rainProbability: "",
    weatherCondition: "",
    forecastDate: new Date().toISOString().split("T")[0],
    forecastDays: "0",
  });

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.weather.list.useQuery({
    location: search || undefined,
    page,
    limit: 20,
  });

  const { data: stats } = trpc.weather.stats.useQuery();

  const createMutation = trpc.weather.create.useMutation({
    onSuccess: () => {
      utils.weather.list.invalidate();
      utils.weather.stats.invalidate();
      setDialogOpen(false);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Weather Data</h1>
          <p className="text-muted-foreground mt-1">
            Manage cached weather data for locations ({stats?.activeLocations ?? 0} active)
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Weather Data</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Location *</Label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Hyderabad"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>District</Label>
                  <Input
                    value={form.district}
                    onChange={(e) => setForm({ ...form, district: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>State</Label>
                  <Input
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Temperature (C)</Label>
                  <Input
                    type="number"
                    value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                    placeholder="32"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Humidity (%)</Label>
                  <Input
                    type="number"
                    value={form.humidity}
                    onChange={(e) => setForm({ ...form, humidity: e.target.value })}
                    placeholder="65"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Wind Speed (km/h)</Label>
                  <Input
                    type="number"
                    value={form.windSpeed}
                    onChange={(e) => setForm({ ...form, windSpeed: e.target.value })}
                    placeholder="12"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rain Probability (%)</Label>
                  <Input
                    type="number"
                    value={form.rainProbability}
                    onChange={(e) =>
                      setForm({ ...form, rainProbability: e.target.value })
                    }
                    placeholder="20"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Condition</Label>
                <Input
                  value={form.weatherCondition}
                  onChange={(e) =>
                    setForm({ ...form, weatherCondition: e.target.value })
                  }
                  placeholder="e.g. Partly cloudy"
                />
              </div>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    location: form.location,
                    district: form.district || undefined,
                    state: form.state || undefined,
                    temperature: parseFloat(form.temperature),
                    humidity: parseInt(form.humidity),
                    windSpeed: parseFloat(form.windSpeed),
                    rainProbability: parseInt(form.rainProbability),
                    weatherCondition: form.weatherCondition,
                    forecastDate: form.forecastDate,
                    forecastDays: parseInt(form.forecastDays),
                    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours
                  })
                }
                disabled={
                  !form.location ||
                  !form.temperature ||
                  !form.humidity ||
                  createMutation.isPending
                }
                className="w-full"
              >
                Add Weather Entry
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search location..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Weather Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.items.map((w) => (
            <Card key={w.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">{w.location}</h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {w.district ? `${w.district}, ` : ""}
                      {w.state}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {w.forecastDays === 0 ? "Today" : `+${w.forecastDays}d`}
                  </Badge>
                </div>

                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <Thermometer className="h-5 w-5 text-orange-500" />
                    <span className="text-2xl font-bold">{w.temperature}C</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {w.weatherCondition}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="flex flex-col items-center gap-1 p-2 bg-muted rounded-lg">
                    <Droplets className="h-4 w-4 text-blue-500" />
                    <span className="font-medium">{w.humidity}%</span>
                    <span className="text-muted-foreground">Humidity</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2 bg-muted rounded-lg">
                    <Wind className="h-4 w-4 text-teal-500" />
                    <span className="font-medium">{w.windSpeed}</span>
                    <span className="text-muted-foreground">km/h</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 p-2 bg-muted rounded-lg">
                    <CloudRain className="h-4 w-4 text-indigo-500" />
                    <span className="font-medium">{w.rainProbability}%</span>
                    <span className="text-muted-foreground">Rain</span>
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground mt-3">
                  Fetched: {w.fetchedAt ? new Date(w.fetchedAt).toLocaleString("en-IN") : "-"}
                </p>
              </CardContent>
            </Card>
          ))}
          {data?.items.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              No weather data found. Add your first weather entry.
            </div>
          )}
        </div>
      )}

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
