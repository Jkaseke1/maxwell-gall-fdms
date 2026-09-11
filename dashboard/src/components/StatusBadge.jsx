const statusColors = {
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  online: 'bg-green-500',
  offline: 'bg-gray-500',
};

export default function StatusBadge({ status, label }) {
  const color = statusColors[status] || statusColors.info;
  
  return (
    <div className="flex items-center gap-2">
      <span className={`w-3 h-3 rounded-full ${color} animate-pulse`}></span>
      <span className="text-sm text-gray-700">{label}</span>
    </div>
  );
}
