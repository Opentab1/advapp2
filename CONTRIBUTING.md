# Contributing to Pulse Dashboard

Thank you for considering contributing to Pulse Dashboard! This document provides guidelines and instructions.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported
2. Use the bug report template
3. Include:
   - Clear description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots (if applicable)
   - Environment details (OS, browser, etc.)

### Suggesting Features

1. Check if feature has been suggested
2. Provide clear use case
3. Explain why it would be beneficial
4. Consider implementation complexity

### Pull Requests

1. **Fork the repository**
```bash
git clone https://github.com/your-username/pulse-dashboard-pwa.git
cd pulse-dashboard-pwa
```

2. **Create a feature branch**
```bash
git checkout -b feature/your-feature-name
```

3. **Make your changes**
   - Follow existing code style
   - Add comments for complex logic
   - Update documentation if needed

4. **Test thoroughly**
```bash
npm run build
npm run preview
```

5. **Commit with clear messages**
```bash
git commit -m "feat: add new feature description"
```

Use conventional commits:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `style:` - Formatting, missing semicolons, etc.
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `test:` - Adding tests
- `chore:` - Maintenance tasks

6. **Push to your fork**
```bash
git push origin feature/your-feature-name
```

7. **Create Pull Request**
   - Provide clear description
   - Reference related issues
   - Add screenshots for UI changes

## Development Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Code Style

### TypeScript
- Use TypeScript for all new files
- Define proper types/interfaces
- Avoid `any` type when possible

### React
- Use functional components
- Prefer hooks over class components
- Keep components small and focused

### Styling
- Use Tailwind CSS utilities
- Follow existing design system
- Maintain responsive design

### File Structure
```
src/
├── components/     # Reusable UI components
├── pages/          # Page components
├── services/       # API and auth services
├── hooks/          # Custom React hooks
├── utils/          # Utility functions
└── types/          # TypeScript types
```

## Component Guidelines

### Creating New Components

```tsx
import { motion } from 'framer-motion';

interface MyComponentProps {
  title: string;
  // ... other props
}

export function MyComponent({ title }: MyComponentProps) {
  return (
    <motion.div
      className="glass-card p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <h2 className="text-xl font-bold">{title}</h2>
      {/* Component content */}
    </motion.div>
  );
}
```

### Component Checklist
- [ ] Proper TypeScript types
- [ ] Responsive design
- [ ] Accessibility (ARIA labels, keyboard nav)
- [ ] Animations (Framer Motion)
- [ ] Error handling
- [ ] Loading states

## Design System

### Colors
```
Navy:  #0a192f (background)
Cyan:  #00d4ff (accent)
White: #ffffff (text)
Gray:  #64748b (secondary text)
```

### Effects
```css
.glass-card          /* Glassmorphism */
.cyan-glow           /* Glow effect */
.gradient-text       /* Gradient text */
```

### Animations
- Use Framer Motion for animations
- Keep animations smooth (0.3s default)
- Use spring physics for natural motion

## Testing

### Manual Testing
- Test on Chrome, Firefox, Safari
- Test on mobile devices
- Test PWA installation
- Test offline functionality
- Test all time ranges
- Test authentication flow

### Checklist
- [ ] Desktop responsive
- [ ] Mobile responsive
- [ ] Dark mode works
- [ ] Animations smooth
- [ ] No console errors
- [ ] PWA installable

## Documentation

- Update README for new features
- Add JSDoc comments for complex functions
- Update DEPLOYMENT_CHECKLIST if needed
- Add examples for new components

## Review Process

Pull requests will be reviewed for:
- Code quality and style
- Functionality and bug fixes
- Performance impact
- Design consistency
- Documentation completeness

## Questions?

- Open a GitHub issue
- Check existing documentation
- Review similar components

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🚀
