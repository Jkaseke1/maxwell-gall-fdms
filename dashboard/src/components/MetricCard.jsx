export default function MetricCard({ title, value, subtitle, icon: Icon, gradient }) {
  return (
    <div 
      className="rounded-xl p-6 text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
      style={{ background: gradient }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm opacity-90">{title}</div>
        {Icon && <Icon className="w-5 h-5 opacity-75" />}
      </div>
      <div className="text-4xl font-bold mb-1">{value}</div>
      {subtitle && (
        <div className="text-xs opacity-75 flex items-center gap-1">
          {subtitle}
        </div>
      )}
    </div>
  );
}
