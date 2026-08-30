// @ts-check
import React, { useState } from 'react';
import { UiBadge } from './UiBadge';

/**
 * Task Checklist component directly inspired by Bonsai's "Upcoming & Overdue Tasks" card.
 * Starts clean with 0 fake items in production.
 */
export function UiTaskChecklist({ initialTasks = [], onTaskToggle, onAddTask }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [filter, setFilter] = useState('all');

  const toggleTask = (taskId) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const updated = { ...t, completed: !t.completed };
        if (onTaskToggle) onTaskToggle(updated);
        return updated;
      }
      return t;
    }));
  };

  const handleCreateTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    const newTask = {
      id: `task-${Date.now()}`,
      title: newTaskTitle,
      dueDate: 'Aujourd\'hui',
      isOverdue: false,
      completed: false,
      assignee: 'LA',
      category: 'Général'
    };
    setTasks(prev => [newTask, ...prev]);
    if (onAddTask) onAddTask(newTask);
    setNewTaskTitle('');
    setShowAddForm(false);
  };

  const filteredTasks = tasks.filter(t => {
    if (filter === 'active') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3
            style={{
              fontSize: '18px',
              fontWeight: '700',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-display)'
            }}
          >
            Tâches Prioritaires & Urentes
          </h3>
          <span title="Action Items for Smart BERRY Operational Teams">
            <i className="fa-solid fa-circle-info" style={{ color: 'var(--text-muted)', fontSize: '13px', cursor: 'help' }}></i>
          </span>
        </div>

        <button
          onClick={() => setShowAddForm(prev => !prev)}
          title="Ajouter une tâche"
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '50%',
            backgroundColor: 'var(--emerald-50)',
            color: 'var(--emerald-600)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '16px',
            cursor: 'pointer',
            transition: 'all var(--transition-fast)'
          }}
        >
          <i className="fa-solid fa-plus"></i>
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleCreateTask} style={{ display: 'flex', gap: '8px', animation: 'fadeIn 0.2s ease-in-out' }}>
          <input
            type="text"
            placeholder="Intitulé de la nouvelle tâche..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              fontSize: '13px',
              outline: 'none'
            }}
            autoFocus
          />
          <button
            type="submit"
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--emerald-600)',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: '600',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Ajouter
          </button>
        </form>
      )}

      {/* Task Filter Pills */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
        {[
          { key: 'all', label: 'Toutes' },
          { key: 'active', label: 'En cours' },
          { key: 'completed', label: 'Terminées' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: '4px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: '600',
              border: 'none',
              backgroundColor: filter === tab.key ? 'var(--text-main)' : 'transparent',
              color: filter === tab.key ? '#FFFFFF' : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Task List Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {filteredTasks.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            <i className="fa-solid fa-list-check" style={{ fontSize: '28px', marginBottom: '8px', opacity: 0.4 }}></i>
            <p style={{ fontWeight: '600' }}>Aucune tâche enregistrée</p>
            <p style={{ fontSize: '12px' }}>Cliquez sur le bouton <strong>"+"</strong> ci-dessus pour ajouter une tâche.</p>
          </div>
        ) : (
          filteredTasks.map(task => (
            <div
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: task.completed ? 'var(--bg-subtle)' : '#FFFFFF',
                border: '1px solid var(--border-subtle)',
                transition: 'all var(--transition-fast)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <button
                  onClick={() => toggleTask(task.id)}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: task.completed ? 'none' : '2px solid var(--border-color)',
                    backgroundColor: task.completed ? 'var(--emerald-600)' : 'transparent',
                    color: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '10px',
                    flexShrink: 0
                  }}
                >
                  {task.completed && <i className="fa-solid fa-check"></i>}
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      color: task.completed ? 'var(--text-muted)' : 'var(--text-main)',
                      textDecoration: task.completed ? 'line-through' : 'none'
                    }}
                  >
                    {task.title}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '500', color: 'var(--text-muted)' }}>
                      {task.dueDate}
                    </span>
                    <UiBadge variant="neutral">{task.category}</UiBadge>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: '#475569',
                    color: '#FFFFFF',
                    fontSize: '11px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {task.assignee}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
