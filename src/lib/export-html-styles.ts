/**
 * Print stylesheet for the export report (AR-01).
 *
 * Kept separate from `export-html.ts` because the rules dominate the markup in
 * size; splitting them lets the structure stay readable and lets tests assert
 * on markup without matching hundreds of lines of CSS.
 */
export const REPORT_STYLES = `
        body {
          font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
          font-size: 11px;
          line-height: 1.35;
          color: #1f2937;
          margin: 0;
          padding: 0;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .header {
          text-align: center;
          margin-bottom: 12px;
          border-bottom: 1px solid #d1d5db;
          padding-bottom: 8px;
        }
        .header h1 {
          margin: 0;
          font-size: 20px;
          color: #111827;
        }
        .header p {
          margin: 4px 0 0 0;
          font-size: 11px;
          color: #6b7280;
        }
        .summary {
          margin: 8px 0 12px;
          padding: 8px;
          background: #f8fafc;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          display: flex;
          justify-content: space-around;
          flex-wrap: wrap;
          gap: 4px;
        }
        .summary-item {
          text-align: center;
          margin: 2px 8px;
        }
        .summary-label {
          font-weight: bold;
          display: block;
          font-size: 10px;
          color: #6b7280;
          letter-spacing: 0.02em;
        }
        .summary-value {
          font-size: 14px;
          font-weight: bold;
          color: #111827;
        }

        /* Date grouping styles */
        .date-section {
          margin-bottom: 10px;
          page-break-inside: auto;
        }
        .date-header {
          background: #2c3e50;
          color: white;
          padding: 8px 10px;
          border-radius: 5px;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: bold;
          page-break-after: avoid;
        }

        /* Job grouping styles */
        .job-section {
          margin-bottom: 8px;
          page-break-inside: auto;
        }
        .job-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 7px 10px;
          border-radius: 5px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: bold;
          page-break-after: avoid;
        }

        /* Project grouping styles */
        .project-section {
          margin-bottom: 6px;
          margin-left: 8px;
          page-break-inside: auto;
        }
        .project-section-primary {
          margin-bottom: 8px;
          page-break-inside: auto;
        }
        .project-header {
          background: #e3f2fd;
          color: #1976d2;
          padding: 6px 9px;
          border-radius: 4px;
          margin-bottom: 6px;
          font-size: 12px;
          font-weight: bold;
          border-left: 4px solid #1976d2;
          page-break-after: avoid;
        }
        .project-header-primary {
          background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
          color: white;
          padding: 8px 10px;
          border-radius: 5px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: bold;
          page-break-after: avoid;
        }
        .project-header-primary .job-name {
          font-size: 11px;
          font-weight: normal;
          opacity: 0.9;
        }

        .task {
          margin-bottom: 6px;
          padding: 8px;
          border: 1px solid #e5e7eb;
          border-radius: 5px;
          background: #ffffff;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .task.completed {
          border-left: 4px solid #28a745;
        }
        .task.in-progress {
          border-left: 4px solid #ffc107;
        }
        .task.on-hold {
          border-left: 4px solid #6f42c1;
        }
        .task.cancelled {
          border-left: 4px solid #dc3545;
          opacity: 0.8;
        }
        .task-header {
          font-weight: bold;
          font-size: 12px;
          margin-bottom: 5px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .status-badge {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 12px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .status-badge.completed {
          background: #28a745;
          color: white;
        }
        .status-badge.in-progress {
          background: #ffc107;
          color: #333;
        }
        .status-badge.on-hold {
          background: #6f42c1;
          color: white;
        }
        .status-badge.cancelled {
          background: #dc3545;
          color: white;
        }
        .task-meta {
          margin-bottom: 4px;
          font-size: 10px;
          color: #6b7280;
        }
        .task-description {
          margin-bottom: 4px;
          font-size: 11px;
          color: #4b5563;
          white-space: pre-line;
        }
        .task-notes {
          margin-top: 4px;
          padding: 6px;
          background: #e8f4ff;
          border-left: 3px solid #2196F3;
          font-size: 10px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-output {
          margin-top: 4px;
          padding: 6px;
          background-color: #f0f8f0;
          border-left: 3px solid #28a745;
          font-size: 10px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-reason {
          margin-top: 4px;
          padding: 6px;
          background: #ffe8e8;
          border-left: 3px solid #f44336;
          font-size: 10px;
          border-radius: 3px;
          white-space: pre-line;
        }
        .task-subtasks {
          margin-top: 4px;
          padding: 6px;
          background-color: #f8f9fa;
          border-left: 3px solid #6c757d;
          font-size: 10px;
          border-radius: 3px;
        }
        .task-subtasks ul {
          margin: 4px 0;
          padding-left: 16px;
        }
        .task-subtasks li {
          margin: 2px 0;
          padding: 1px 0;
        }
        .task-subtasks li.completed {
          color: #28a745;
          text-decoration: line-through;
        }
        .task-subtasks li.pending {
          color: #6c757d;
        }
        .footer {
          text-align: center;
          margin-top: 10px;
          font-size: 10px;
          color: #9ca3af;
          border-top: 1px solid #e5e7eb;
          padding-top: 6px;
        }
        @media print {
          body { margin: 0; }
          .date-section,
          .job-section,
          .project-section,
          .project-section-primary {
            page-break-inside: auto;
            break-inside: auto;
          }
          .task,
          .date-header,
          .job-header,
          .project-header,
          .project-header-primary {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }`;
