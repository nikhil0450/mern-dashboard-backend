const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const axios = require('axios');
const Transaction = require('./models/Transaction');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log("Database connected successfully");
}).catch(err => console.log(err));

app.get('/initialize', async (req, res) => {
  try {
    const response = await axios.get('https://s3.amazonaws.com/roxiler.com/product_transaction.json');
    const transactions = response.data;

    await Transaction.deleteMany({});
    await Transaction.insertMany(transactions);

    res.status(200).send("Database Initialized");
  } catch (error) {
    res.status(500).send("Error initializing database");
  }
});

app.get('/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', month } = req.query;
    const searchRegex = new RegExp(search, 'i');

    let query = {
      $or: [
        { title: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { category: { $regex: searchRegex } }
      ]
    };

    if (month) {
      const monthNumber = new Date(`${month} 1, 2020`).getMonth() + 1;
      query.$expr = {
        $eq: [{ $month: "$dateOfSale" }, monthNumber]
      };
    }

    const transactions = await Transaction.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Transaction.countDocuments(query);

    res.status(200).json({
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching transactions', error: err });
  }
});

app.get('/transactions/stats', async (req, res) => {
  try {
    const { month } = req.query;
    const monthNumber = new Date(`${month} 1, 2020`).getMonth() + 1;

    const totalSales = await Transaction.aggregate([
      { $match: { $expr: { $eq: [{ $month: "$dateOfSale" }, monthNumber] }, sold: true } },
      { $group: { _id: null, total: { $sum: '$price' } } }
    ]);

    const totalSoldItems = await Transaction.countDocuments({ $expr: { $eq: [{ $month: "$dateOfSale" }, monthNumber] }, sold: true });
    const totalUnsoldItems = await Transaction.countDocuments({ $expr: { $eq: [{ $month: "$dateOfSale" }, monthNumber] }, sold: false });

    res.status(200).json({
      totalSales: totalSales[0]?.total || 0,
      totalSoldItems,
      totalUnsoldItems,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching statistics', error: err });
  }
});

app.get('/transactions/chart', async (req, res) => {
  try {
    const { month } = req.query;
    const monthNumber = new Date(`${month} 1, 2020`).getMonth() + 1;

    const priceDistribution = await Transaction.aggregate([
      { $match: { $expr: { $eq: [{ $month: "$dateOfSale" }, monthNumber] } } },
      {
        $bucket: {
          groupBy: '$price',
          boundaries: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, Infinity],
          default: 'Other',
          output: { count: { $sum: 1 } }
        }
      }
    ]);

    res.status(200).json({
      priceDistribution,
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching chart data', error: err });
  }
});

app.get('/api/bar-chart-data', async (req, res) => {
  try {
    const { month } = req.query;
    const monthNumber = new Date(`${month} 1, 2020`).getMonth() + 1;

    const data = await Transaction.aggregate([
      { $match: { $expr: { $eq: [{ $month: "$dateOfSale" }, monthNumber] } } },
      { $group: { _id: "$category", count: { $sum: 1 } } }
    ]);

    const labels = data.map(d => d._id);
    const counts = data.map(d => d.count);

    res.json({ labels, data: counts });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bar chart data' });
  }
});

app.get('/api/pie-chart-data', async (req, res) => {
  try {
    const { month } = req.query;
    const monthNumber = new Date(`${month} 1, 2020`).getMonth() + 1;

    const data = await Transaction.aggregate([
      { $match: { $expr: { $eq: [{ $month: "$dateOfSale" }, monthNumber] } } },
      { $group: { _id: "$category", count: { $sum: 1 } } }
    ]);

    const labels = data.map(d => d._id);
    const counts = data.map(d => d.count);

    res.json({ labels, data: counts });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching pie chart data' });
  }
});

app.get('/combined', async (req, res) => {
  try {
    const { month } = req.query;

    const [transactionsResponse, statisticsResponse, chartResponse] = await Promise.all([
      axios.get(`http://localhost:5000/transactions`, { params: { month } }),
      axios.get(`http://localhost:5000/transactions/stats`, { params: { month } }),
      axios.get(`http://localhost:5000/transactions/chart`, { params: { month } })
    ]);

    res.json({
      transactions: transactionsResponse.data,
      statistics: statisticsResponse.data,
      chart: chartResponse.data,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching combined data', error });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
