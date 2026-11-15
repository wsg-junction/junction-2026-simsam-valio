import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AssistantApp } from '@/assistant/app';

// Aimo Assistant: a mock consumer chatbot for buying from Valio Aimo. The previous storefront pages under
// src/pages are no longer routed.
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <AssistantApp />
    </StrictMode>,
);
