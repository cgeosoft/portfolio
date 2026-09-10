/**
 * Presentation tokens of metric modules. A manifest names a lucide icon and a
 * design accent; this file maps both to the components and classes the UI
 * uses. Values, formatting, and descriptions come from the module and its
 * manifest, never from here.
 */

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Anchor,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Banknote,
  BarChart3,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  CircleDollarSign,
  Clock,
  Coins,
  Compass,
  CreditCard,
  Crosshair,
  Divide,
  Droplets,
  Flame,
  FlaskConical,
  Gauge,
  Globe,
  Hash,
  Landmark,
  Layers,
  LineChart,
  Percent,
  PieChart,
  PiggyBank,
  Receipt,
  Scale,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sigma,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
  Waves,
  Zap,
} from "lucide-react";
import type { MetricAccent } from "../../../../shared/metric-manifest";

/** Lucide icons a manifest may name (kebab-case). Unknown names fall back to a gauge. */
const METRIC_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  anchor: Anchor,
  "arrow-down-right": ArrowDownRight,
  "arrow-up-right": ArrowUpRight,
  award: Award,
  banknote: Banknote,
  "bar-chart-3": BarChart3,
  briefcase: Briefcase,
  "building-2": Building2,
  calculator: Calculator,
  calendar: Calendar,
  "circle-dollar-sign": CircleDollarSign,
  clock: Clock,
  coins: Coins,
  compass: Compass,
  "credit-card": CreditCard,
  crosshair: Crosshair,
  divide: Divide,
  droplets: Droplets,
  flame: Flame,
  "flask-conical": FlaskConical,
  gauge: Gauge,
  globe: Globe,
  hash: Hash,
  landmark: Landmark,
  layers: Layers,
  "line-chart": LineChart,
  percent: Percent,
  "pie-chart": PieChart,
  "piggy-bank": PiggyBank,
  receipt: Receipt,
  scale: Scale,
  shield: Shield,
  "shield-alert": ShieldAlert,
  "shield-check": ShieldCheck,
  sigma: Sigma,
  sparkles: Sparkles,
  target: Target,
  timer: Timer,
  "trending-down": TrendingDown,
  "trending-up": TrendingUp,
  trophy: Trophy,
  wallet: Wallet,
  waves: Waves,
  zap: Zap,
};

export const METRIC_ICON_NAMES: readonly string[] = Object.keys(METRIC_ICONS);

export function getMetricIcon(name: string): LucideIcon {
  return METRIC_ICONS[name] ?? Gauge;
}

/** Tailwind text color class of each design accent. */
const ACCENT_CLASSES: Record<MetricAccent, string> = {
  pink: "text-[#DD3C73]",
  mint: "text-[#A7E2C0]",
  cream: "text-[#E3EACD]",
  blue: "text-[#7392fa]",
  navy: "text-[#243C8F]",
  slate: "text-slate-400",
};

export function getMetricAccentClass(accent: MetricAccent): string {
  return ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.slate;
}
