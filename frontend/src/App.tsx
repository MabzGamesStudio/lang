import { BrowserRouter, Routes, Route } from "react-router-dom";
import Menu from "./pages/Menu";
import Minigames from "./pages/Minigames";
import ForeignWordPickEnglishList from "./pages/minigamePages/ForeignWordPickEnglishList";
import EnglishWordPickForeignList from "./pages/minigamePages/EnglishWordPickForeignList";
import ForeignWordTypeEnglishWord from "./pages/minigamePages/ForeignWordTypeEnglishWord";
import EnglishWordTypeForeignWord from "./pages/minigamePages/EnglishWordTypeForeignWord";

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Menu />} />
                <Route path="/minigames" element={<Minigames />} />
                <Route path="/minigames/foreignWordPickEnglishList" element={<ForeignWordPickEnglishList />} />
                <Route path="/minigames/englishWordPickForeignList" element={<EnglishWordPickForeignList />} />
                <Route path="/minigames/foreignWordTypeEnglishWord" element={<ForeignWordTypeEnglishWord />} />
                <Route path="/minigames/englishWordTypeForeignWord" element={<EnglishWordTypeForeignWord />} />
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