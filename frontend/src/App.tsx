import { BrowserRouter, Routes, Route } from "react-router-dom";
import Menu from "./pages/Menu";
import Minigames from "./pages/Minigames";
import ForeignWordPickEnglishList from "./pages/minigamePages/ForeignWordPickEnglishList";

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Menu />} />
                <Route path="/minigames" element={<Minigames />} />
                <Route path="/minigames/foreignWordPickEnglishList" element={<ForeignWordPickEnglishList />} />
                <Route path="*" element={<NotFoundPage />} />
            </Routes>
        </BrowserRouter>
    );
}

function NotFoundPage() {
    return (
        <div style={{ textAlign: 'center', marginTop: '50px' }}>
            <h1>404 - Page Not Found</h1>
            <p>The page you are looking for doesn't exist.</p>
            <a href="/">Go Back Home</a>
        </div>
    );
}

export default App;