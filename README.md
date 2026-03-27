# � GID Task Flow

<div align="center">
  <img src="./public/logo.svg" alt="GID Task Flow Logo" width="120" height="120">
  
  ![License](https://img.shields.io/badge/license-MIT-blue.svg)
  ![Node.js Version](https://img.shields.io/badge/node.js-20%2B-green.svg)
  ![Next.js](https://img.shields.io/badge/Next.js-16.2.1-black.svg)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)
  ![Prisma](https://img.shields.io/badge/Prisma-7.5.0-indigo.svg)
  ![SQLite](https://img.shields.io/badge/SQLite-3.0-blue.svg)
  ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4.0-38B2FF.svg)
</div>

A modern, enterprise-grade task management application built with Next.js, TypeScript, and Prisma. Track tasks, manage subtasks, configure breaks, and export professional reports with a beautiful glassmorphism UI.

## ✨ Features

### 🎯 Core Task Management
- **Task Creation**: Create tasks with rich descriptions and project associations
- **Status Tracking**: In-progress, completed, and cancelled states
- **Time Tracking**: Automatic elapsed time calculation
- **Progress Notes**: Add detailed notes during task execution
- **Work Output**: Document completion results and outputs

### 📋 Subtask Management
- **Nested Tasks**: Break down complex tasks into manageable subtasks
- **Progress Tracking**: Visual completion status with checkboxes
- **Completion Counter**: Shows X/Y completed format
- **Smart Validation**: Only allows subtasks for in-progress tasks

### 📅 Date-wise Organization
- **Smart Grouping**: Tasks automatically organized by creation date
- **Collapsible Sections**: Expand/collapse date groups for better organization
- **Visual Hierarchy**: Clear date headers with task counts
- **Responsive Layout**: Works seamlessly on all screen sizes

### ⏱️ Break Management
- **Configurable Breaks**: Set up custom break types and durations
- **One-time & Recurring**: Flexible break scheduling options
- **Duration-based**: Set break lengths in minutes (not time-based)
- **Quick Selection**: Easy break type selection during work

### 📊 Professional Exports
- **PDF Reports**: Generate professional PDF activity reports
- **Complete Data**: Includes tasks, subtasks, notes, and outputs
- **Rich Formatting**: Professional layout with proper styling
- **Fallback Support**: HTML export if PDF generation fails

### 🔐 Authentication & Security
- **Session Management**: Secure user authentication
- **Password Protection**: Hashed password storage
- **Session Persistence**: Automatic login state management
- **Secure APIs**: Protected routes with proper authorization

### ⚙️ User Settings
- **Work Hours**: Configure daily work schedules
- **Break Configuration**: Customize break types and durations
- **Project Management**: Create and organize projects
- **Responsive Settings**: Works across all devices

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ 
- npm or yarn package manager
- SQLite 3 (included)

### Installation

```bash
# Clone the repository
git clone https://github.com/muisdevop/project-tasks-log.git

# Navigate to project directory
cd project-tasks-log

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Run database migrations
npx prisma migrate dev

# Start development server
npm run dev
```

### Docker Setup

```bash
# Build and run with Docker Compose
docker-compose up --build

# Or run individual services
docker-compose up -d db
npm run dev
```

## 📁 Project Structure

```
project-tasks-log/
├── src/
│   ├── app/                 # Next.js app router
│   │   ├── api/            # API routes
│   │   │   ├── auth/        # Authentication endpoints
│   │   │   ├── breaks/       # Break management
│   │   │   ├── export/       # PDF export
│   │   │   ├── projects/     # Project CRUD
│   │   │   ├── settings/     # User settings
│   │   │   ├── subtasks/     # Subtask management
│   │   │   └── tasks/        # Task CRUD & actions
│   │   ├── components/      # React components
│   │   └── globals.css      # Global styles
│   ├── lib/                 # Utility functions
│   │   ├── auth.ts          # Authentication helpers
│   │   ├── prisma.ts        # Database client
│   │   ├── session.ts       # Session management
│   │   └── validators.ts    # Input validation
│   └── components/           # Shared React components
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── migrations/           # Database migrations
├── public/                  # Static assets
├── docker-compose.yml         # Docker configuration
└── package.json
```

## 🛠️ Technology Stack

### Frontend
- **Next.js 16**: React framework with App Router
- **TypeScript 5**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework
- **React Hook Form**: Form management
- **Zod**: Runtime type validation
- **TipTap**: Rich text editor

### Backend
- **Next.js API**: Server-side API routes
- **Prisma ORM**: Type-safe database access
- **SQLite**: Lightweight database solution
- **NextAuth**: Authentication library
- **Puppeteer**: PDF generation

### DevOps
- **Docker**: Containerization support
- **Docker Compose**: Multi-service orchestration
- **GitHub Actions**: CI/CD pipeline
- **ESLint**: Code quality assurance

## 📊 Database Schema

The application uses a well-structured relational database with the following key models:

### Core Entities
- **User**: Authentication and session management
- **Project**: Task organization and grouping
- **Task**: Main task entity with status tracking
- **SubTask**: Nested task breakdown
- **BreakType**: Configurable break management
- **TaskEvent**: Activity logging and auditing

### Relationships
- Users can manage multiple projects
- Projects contain multiple tasks
- Tasks can have multiple subtasks
- Breaks are user-configurable
- All entities maintain audit trails

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL="file:./dev.db"

# Next.js
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"

# Application
NODE_ENV="development"
PORT=3000
```

### Database Configuration

```typescript
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

## 📝 API Documentation

### Authentication Endpoints

```typescript
// Login
POST /api/auth/login
{
  "username": string,
  "password": string
}

// Logout
POST /api/auth/logout

// Session check
GET /api/auth/session
```

### Task Management

```typescript
// Get tasks
GET /api/tasks?projectId=1

// Create task
POST /api/tasks
{
  "title": string,
  "description": string,
  "projectId": number
}

// Update task
PATCH /api/tasks
{
  "taskId": number,
  "action": "complete" | "cancel" | "resume" | "log-notes",
  "details": string,    // For completion/cancellation
  "notes": string       // For progress notes
}
```

### Break Management

```typescript
// Get breaks
GET /api/breaks

// Create break
POST /api/breaks
{
  "name": string,
  "type": string,
  "duration": number,    // Minutes (null for recurring)
  "isOneTime": boolean
}
```

## 🎨 UI Components

### Core Components
- **TaskBoard**: Main task management interface
- **SubTasks**: Nested task management
- **BreaksConfig**: Break type configuration
- **RichTextEditor**: WYSIWYG text editing
- **TaskActionModal**: Task completion/cancellation
- **LogNotesModal**: Progress note management

### Design System
- **Responsive Design**: Mobile-first approach
- **Dark Mode**: Automatic theme detection
- **Accessibility**: WCAG 2.1 compliance
- **Micro-interactions**: Smooth transitions and feedback

## 🔒 Security Features

### Authentication
- **Password Hashing**: Secure password storage
- **Session Management**: Secure session handling
- **CSRF Protection**: Cross-site request forgery prevention
- **Rate Limiting**: API abuse prevention

### Data Protection
- **Input Validation**: Comprehensive input sanitization
- **SQL Injection Prevention**: Parameterized queries
- **XSS Protection**: Content sanitization
- **HTTPS Support**: Secure data transmission

## 📈 Performance

### Optimization Techniques
- **Code Splitting**: Automatic bundle optimization
- **Image Optimization**: Next.js image processing
- **Database Indexing**: Optimized query performance
- **Caching Strategy**: Intelligent data caching
- **Lazy Loading**: On-demand component loading

### Metrics
- **Bundle Size**: Optimized for fast loading
- **Database Performance**: Efficient query patterns
- **Memory Usage**: Optimized resource consumption
- **Response Times**: Fast API responses

## 🧪 Testing

### Test Coverage
- **Unit Tests**: Component and utility testing
- **Integration Tests**: API endpoint testing
- **E2E Tests**: Complete user flows
- **Database Tests**: Schema validation

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e

# Generate coverage report
npm run test:coverage
```

## 🚀 Deployment

### Production Deployment

```bash
# Build for production
npm run build

# Start production server
npm start

# Docker deployment
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Setup
- **Development**: Local development with hot reload
- **Staging**: Pre-production testing environment
- **Production**: Optimized for production workloads

## 🤝 Contributing

We welcome contributions! Please follow our guidelines:

### Development Workflow
1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Code Standards
- **TypeScript**: Strict type checking enabled
- **ESLint**: Code style enforcement
- **Prettier**: Code formatting
- **Conventional Commits**: Standardized commit messages

### Pull Request Process
- **Description**: Clear problem statement and solution
- **Tests**: Include relevant test cases
- **Documentation**: Update relevant docs
- **Review**: Code review requirements

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Next.js Team**: Excellent framework and documentation
- **Prisma Team**: Powerful ORM and tooling
- **Tailwind CSS**: Utility-first CSS framework
- **Vercel**: Hosting and deployment platform

## 📞 Support

For support and questions:

- 📧 Email: support@gidstudio.com
- 🐛 Issues: [GitHub Issues](https://github.com/muisdevop/project-tasks-log/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/muisdevop/project-tasks-log/discussions)
- 📖 Documentation: [Project Wiki](https://github.com/muisdevop/project-tasks-log/wiki)

---

<div align="center">
  <strong>Built with ❤️ by MUIS at GID Studio</strong>
</div>
