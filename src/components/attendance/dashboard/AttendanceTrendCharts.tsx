import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { AttendanceTrendPoint } from '../../../types/attendance'
import { STATUS_COLORS } from '../../../utils/attendance/attendanceStatusColors'

type Props = {
  data: AttendanceTrendPoint[]
}

export function AttendanceTrendCharts({ data }: Props) {
  if (!data.length) {
    return (
      <div className="adash-panel">
        <h3 className="adash-panel__title">Trends (last 7 days in month)</h3>
        <p className="adash-empty">No trend data</p>
      </div>
    )
  }

  const chartData = data.map((p) => ({
    ...p,
    short: p.day,
  }))

  return (
    <div className="adash-panel">
      <h3 className="adash-panel__title">Trends (last 7 days in month)</h3>
      <div className="adash-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line
              type="monotone"
              dataKey="present"
              name="Present"
              stroke={STATUS_COLORS.P.text}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="absent"
              name="Absent"
              stroke={STATUS_COLORS.A.text}
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="sickLeave"
              name="Sick leave"
              stroke={STATUS_COLORS.SL.text}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
