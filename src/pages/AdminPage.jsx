import { useEffect, useMemo, useState } from 'react'
import {
  deleteStudent,
  deleteSubmission,
  loadPendingStudents,
  loadSubmissions,
  setAdminApiKey,
} from '../utils/api'
import NotificationToast from '../components/admin/NotificationToast'
import QuestionSetModal from '../components/admin/QuestionSetModal'
import SubmissionsTable from '../components/admin/SubmissionsTable'
import './AdminPage.css'

const ITEMS_PER_PAGE = 7
const TEACHER_PIN = import.meta.env.VITE_TEACHER_PIN || ''

function formatDateTime(value) {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'N/A'
  return date.toLocaleString()
}

function ProgressChart({ items }) {
  if (items.length === 0) {
    return <div className="chart-empty">No completed exam yet.</div>
  }

  const width = 760
  const height = 230
  const leftPad = 42
  const rightPad = 18
  const topPad = 14
  const bottomPad = 30
  const chartWidth = width - leftPad - rightPad
  const chartHeight = height - topPad - bottomPad

  const points = items.map((item, index) => {
    const percent = item.totalMarks > 0 ? (item.score / item.totalMarks) * 100 : 0
    const x = leftPad + (items.length === 1 ? chartWidth / 2 : (index / (items.length - 1)) * chartWidth)
    const y = topPad + ((100 - percent) / 100) * chartHeight
    return { ...item, percent, x, y }
  })

  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="progress-chart" role="img" aria-label="Score trend">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = topPad + ((100 - tick) / 100) * chartHeight
          return (
            <g key={tick}>
              <line x1={leftPad} y1={y} x2={width - rightPad} y2={y} className="chart-grid-line" />
              <text x={leftPad - 8} y={y + 4} className="chart-axis-label">
                {tick}
              </text>
            </g>
          )
        })}

        {points.length > 1 && <path d={linePath} className="chart-line" />}

        {points.map((point) => (
          <g key={point.timestamp}>
            <circle cx={point.x} cy={point.y} r="5" className="chart-dot" />
            <title>
              {`${point.label}: ${point.score.toFixed(2)} / ${point.totalMarks} (${point.percent.toFixed(1)}%)`}
            </title>
          </g>
        ))}
      </svg>

      <div className="chart-attempts">
        {points.map((point) => (
          <span key={point.timestamp} className="attempt-pill">
            {point.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function AdminPage() {
  const [submissions, setSubmissions] = useState([])
  const [pendingStudents, setPendingStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [notification, setNotification] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [pinInput, setPinInput] = useState('')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [pinUnlocked, setPinUnlocked] = useState(() => {
    if (!TEACHER_PIN) return true
    return sessionStorage.getItem('teacher_admin_unlock') === '1'
  })

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(loadData, 30000)
    return () => clearInterval(id)
  }, [autoRefresh])

  async function loadData() {
    try {
      setLoading(true)
      const [submissionsData, pendingData] = await Promise.all([
        loadSubmissions(),
        loadPendingStudents().catch(() => []),
      ])
      setSubmissions(Array.isArray(submissionsData) ? submissionsData : [])
      setPendingStudents(Array.isArray(pendingData) ? pendingData : [])
      setError(null)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message || 'Failed to load admin data.')
    } finally {
      setLoading(false)
    }
  }

  const studentNames = useMemo(() => {
    const names = new Set()
    submissions.forEach((row) => row?.studentName && names.add(row.studentName))
    pendingStudents.forEach((row) => row?.studentName && names.add(row.studentName))
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [submissions, pendingStudents])

  useEffect(() => {
    if (!studentNames.length) {
      setSelectedStudent('')
      return
    }
    if (!selectedStudent || !studentNames.includes(selectedStudent)) {
      setSelectedStudent(studentNames[0])
    }
  }, [studentNames, selectedStudent])

  const selectedStudentSubmissions = useMemo(() => {
    return submissions
      .filter((row) => row.studentName === selectedStudent)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  }, [submissions, selectedStudent])

  const selectedPending = useMemo(() => {
    return pendingStudents.find((row) => row.studentName === selectedStudent) || null
  }, [pendingStudents, selectedStudent])

  const chartItems = useMemo(() => {
    return selectedStudentSubmissions.map((row, index) => ({
      ...row,
      label: `Attempt ${index + 1}`,
      score: Number(row.score || 0),
      totalMarks: Number(row.totalMarks || 100),
    }))
  }, [selectedStudentSubmissions])

  const focusStats = useMemo(() => {
    const attempts = selectedStudentSubmissions.length
    const bestScore = attempts ? Math.max(...selectedStudentSubmissions.map((s) => Number(s.score || 0))) : 0
    const avgScore = attempts
      ? selectedStudentSubmissions.reduce((sum, s) => sum + Number(s.score || 0), 0) / attempts
      : 0
    const latest = attempts ? selectedStudentSubmissions[attempts - 1] : null
    const first = attempts ? selectedStudentSubmissions[0] : null
    const improvement = first && latest ? Number(latest.score || 0) - Number(first.score || 0) : 0
    return { attempts, bestScore, avgScore, latest, improvement }
  }, [selectedStudentSubmissions])

  const filteredRows = useMemo(() => {
    if (!selectedStudent) return []

    const term = searchTerm.trim().toLowerCase()
    const rows = selectedStudentSubmissions
      .slice()
      .reverse()
      .map((item) => ({
        ...item,
        isPending: false,
      }))

    if (selectedPending) {
      rows.unshift({
        ...selectedPending,
        timestamp: selectedPending.timestamp,
        status: 'Pending',
        isPending: true,
      })
    }

    if (!term) return rows
    return rows.filter((row) => {
      return (
        row.studentName?.toLowerCase().includes(term) ||
        row.studentId?.toLowerCase().includes(term) ||
        row.questionFile?.toLowerCase().includes(term)
      )
    })
  }, [searchTerm, selectedPending, selectedStudent, selectedStudentSubmissions])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / ITEMS_PER_PAGE))
  const paginatedRows = filteredRows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  async function handleDelete(studentName, timestamp) {
    if (!window.confirm(`Delete this attempt for ${studentName}?`)) return
    try {
      await deleteSubmission(studentName, timestamp)
      await loadData()
      setNotification({ type: 'success', message: 'Attempt deleted.' })
    } catch (err) {
      setNotification({ type: 'error', message: err.message || 'Delete failed.' })
    }
  }

  async function handleDeleteStudent(studentName) {
    if (!window.confirm(`Delete all attempts for ${studentName}?`)) return
    try {
      await deleteStudent(studentName)
      await loadData()
      setNotification({ type: 'success', message: `${studentName} data cleared.` })
    } catch (err) {
      setNotification({ type: 'error', message: err.message || 'Delete failed.' })
    }
  }

  if (error) {
    return (
      <div className="admin-page">
        <div className="admin-error-card">
          <h2>Admin data failed to load</h2>
          <p>{error}</p>
          <button type="button" className="refresh-btn" onClick={loadData}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!pinUnlocked) {
    return (
      <div className="admin-page">
        <div className="admin-error-card">
          <h2>Teacher Access</h2>
          <p>Enter your teacher PIN to open admin view.</p>
          <input
            type="password"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            className="field-input"
            placeholder="PIN"
          />
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            className="field-input"
            placeholder="Optional API key"
          />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => {
              if (pinInput === TEACHER_PIN) {
                if (apiKeyInput.trim()) {
                  setAdminApiKey(apiKeyInput.trim())
                }
                sessionStorage.setItem('teacher_admin_unlock', '1')
                setPinUnlocked(true)
              }
            }}
          >
            Unlock
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-hero">
        <div>
          <h1>Teacher Dashboard</h1>
          <p>Focused tracking for one student with visual growth over attempts.</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="outline-btn" onClick={loadData} disabled={loading}>
            Refresh
          </button>
          <button type="button" className={`outline-btn ${autoRefresh ? 'active' : ''}`} onClick={() => setAutoRefresh((v) => !v)}>
            Auto {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button type="button" className="outline-btn" onClick={() => setShowSettingsModal(true)}>
            Question Set
          </button>
          {TEACHER_PIN && (
            <button
              type="button"
              className="outline-btn"
              onClick={() => {
                sessionStorage.removeItem('teacher_admin_unlock')
                setPinUnlocked(false)
                setPinInput('')
              }}
            >
              Lock
            </button>
          )}
        </div>
      </div>

      <div className="admin-content">
        <div className="focus-bar">
          <div className="field">
            <label htmlFor="student">Student</label>
            <select
              id="student"
              value={selectedStudent}
              onChange={(e) => {
                setSelectedStudent(e.target.value)
                setCurrentPage(1)
              }}
              className="field-input"
            >
              {studentNames.length === 0 && <option value="">No student</option>}
              {studentNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="field grow">
            <label htmlFor="search">Search</label>
            <input
              id="search"
              className="field-input"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              placeholder="Filter by id or question file"
            />
          </div>

          <div className="refresh-info">
            Last sync
            <strong>{lastRefresh ? formatDateTime(lastRefresh) : 'Never'}</strong>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span>Attempts</span>
            <strong>{focusStats.attempts}</strong>
          </div>
          <div className="stat-card">
            <span>Best Score</span>
            <strong>{focusStats.bestScore.toFixed(2)}</strong>
          </div>
          <div className="stat-card">
            <span>Average Score</span>
            <strong>{focusStats.avgScore.toFixed(2)}</strong>
          </div>
          <div className="stat-card">
            <span>Progress</span>
            <strong className={focusStats.improvement >= 0 ? 'trend-up' : 'trend-down'}>
              {focusStats.improvement >= 0 ? '+' : ''}
              {focusStats.improvement.toFixed(2)}
            </strong>
          </div>
        </div>

        <div className="chart-card">
          <div className="card-head">
            <h2>Performance Growth</h2>
            <span>{selectedStudent || 'No student selected'}</span>
          </div>
          <ProgressChart items={chartItems} />
          {focusStats.latest && (
            <div className="latest-meta">
              Latest: {focusStats.latest.score} / {focusStats.latest.totalMarks} at{' '}
              {formatDateTime(focusStats.latest.timestamp)}
            </div>
          )}
          {selectedPending && (
            <div className="pending-chip">
              Live exam in progress: question {selectedPending.currentQuestion || 0} /{' '}
              {selectedPending.totalQuestions || 0}
            </div>
          )}
        </div>

        <SubmissionsTable
          submissions={paginatedRows}
          onDelete={handleDelete}
          onDeleteStudent={handleDeleteStudent}
          loading={loading}
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filteredRows.length}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
        />
      </div>

      {notification && (
        <NotificationToast message={notification.message} type={notification.type} onClose={() => setNotification(null)} />
      )}

      <QuestionSetModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        onSave={(fileName) => {
          setNotification({ type: 'success', message: `Active question file: ${fileName}` })
          loadData()
        }}
      />
    </div>
  )
}

export default AdminPage
