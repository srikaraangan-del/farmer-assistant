import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  MessageSquare,
  TrendingUp,
  Landmark,
  CloudSun,
  Sprout,
  Activity,
  Phone,
} from "lucide-react";
import { Link } from "react-router";

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  href,
  color,
}: {
  title: string;
  value: number | string;
  subtitle: string;
  icon: React.ElementType;
  href: string;
  color: string;
}) {
  return (
    <Link to={href} className="block">
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className="text-3xl font-bold tracking-tight">{value}</p>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <div className={`h-12 w-12 rounded-lg ${color} flex items-center justify-center`}>
              <Icon className="h-6 w-6 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-12 w-12 rounded-lg" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading } = trpc.analytics.dashboard.useQuery();
  const { data: activity } = trpc.analytics.dailyActivity.useQuery({ days: 7 });
  const { data: recentMessages } = trpc.analytics.recentActivity.useQuery({
    limit: 10,
  });
  const { data: topIntents } = trpc.analytics.topIntents.useQuery({ limit: 5 });
  const { data: langDist } = trpc.analytics.languageDistribution.useQuery();

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of your AI Farmer Assistant
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              title="Total Farmers"
              value={stats?.farmers.total ?? 0}
              subtitle={`${stats?.farmers.active ?? 0} active`}
              icon={Users}
              href="/farmers"
              color="bg-blue-500"
            />
            <KpiCard
              title="Messages Today"
              value={stats?.messages.today ?? 0}
              subtitle={`${stats?.messages.total ?? 0} total`}
              icon={MessageSquare}
              href="/conversations"
              color="bg-green-500"
            />
            <KpiCard
              title="Active Conversations"
              value={stats?.conversations.active ?? 0}
              subtitle={`${stats?.conversations.today ?? 0} started today`}
              icon={Activity}
              href="/conversations"
              color="bg-amber-500"
            />
            <KpiCard
              title="Market Prices"
              value={stats?.marketPrices ?? 0}
              subtitle="commodities tracked"
              icon={TrendingUp}
              href="/market-prices"
              color="bg-purple-500"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              title="Govt Schemes"
              value={stats?.schemes ?? 0}
              subtitle="active schemes"
              icon={Landmark}
              href="/schemes"
              color="bg-rose-500"
            />
            <KpiCard
              title="Weather Locations"
              value={stats?.weatherLocations ?? 0}
              subtitle="monitored areas"
              icon={CloudSun}
              href="/weather"
              color="bg-sky-500"
            />
            <KpiCard
              title="Conversations"
              value={stats?.conversations.total ?? 0}
              subtitle="all time"
              icon={Phone}
              href="/conversations"
              color="bg-teal-500"
            />
            <KpiCard
              title="WhatsApp Status"
              value="Active"
              subtitle="webhook online"
              icon={Sprout}
              href="/whatsapp"
              color="bg-emerald-500"
            />
          </>
        )}
      </div>

      {/* Charts & Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Activity (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {activity?.messages && activity.messages.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-end gap-2 h-40">
                  {activity.messages.map((day) => (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center gap-1"
                    >
                      <div
                        className="w-full bg-primary/80 rounded-t-md min-h-[4px] transition-all"
                        style={{
                          height: `${Math.min(
                            (day.count /
                              Math.max(
                                ...activity.messages.map((d) => d.count),
                                1
                              )) *
                              120,
                            120
                          )}px`,
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(day.date)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Messages: {activity.messages.reduce((a, b) => a + b.count, 0)}</span>
                  <span>Conversations: {activity.conversations.reduce((a, b) => a + b.count, 0)}</span>
                </div>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                No activity data yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Language Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Language Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {langDist && langDist.length > 0 ? (
              <div className="space-y-3">
                {langDist.map((item) => (
                  <div key={item.language} className="flex items-center gap-3">
                    <span className="text-sm capitalize w-16">{item.language}</span>
                    <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/70 rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            (item.count /
                              Math.max(...langDist.map((d) => d.count))) *
                              100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium w-8 text-right">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                No language data yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Intents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Intents</CardTitle>
          </CardHeader>
          <CardContent>
            {topIntents && topIntents.length > 0 ? (
              <div className="space-y-3">
                {topIntents.map((item) => (
                  <div key={item.intent} className="flex items-center gap-3">
                    <span className="text-sm w-28 truncate">{item.intent}</span>
                    <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500/70 rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            (item.count /
                              Math.max(...topIntents.map((d) => d.count))) *
                              100,
                            100
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium w-8 text-right">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                No intent data yet
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Messages</CardTitle>
          </CardHeader>
          <CardContent>
            {recentMessages && recentMessages.length > 0 ? (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {recentMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div
                      className={`h-2 w-2 rounded-full mt-2 shrink-0 ${
                        msg.senderType === "farmer"
                          ? "bg-blue-500"
                          : msg.senderType === "ai"
                            ? "bg-green-500"
                            : "bg-gray-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {msg.farmerName ?? msg.farmerPhone ?? "Unknown"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {msg.senderType}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {msg.content}
                      </p>
                      {msg.intentDetected && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          {msg.intentDetected}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
                No recent messages
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
